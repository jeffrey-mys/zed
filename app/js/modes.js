/*global define, _, zed */
define(function(require, exports, module) {
    "use strict";
    plugin.consumes = ["eventbus", "command"];
    plugin.provides = ["modes"];
    return plugin;

    function longestFirst(a, b) {
        return b.length - a.length;
    }

    function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    function plugin(options, imports, register) {
        var path = require("./lib/path");

        var eventbus = imports.eventbus;
        var command = imports.command;

        eventbus.declare("modesloaded");
        eventbus.declare("modeset");

        var modes = {};

        // Mappings from file extension to mode name, e.g. "js" -> "javascript"
        var extensionMapping = {};
        var extensionsByLength = [];

        // Mappings from particular file names to mode name, e.g. "Makefile" -> "makefile"
        var filenameMapping = {};

        // Mappings from shebang lines to mode name, e.g. "python3" -> "python"
        var shebangMapping = {};

        // Mode to use if all else fails
        var fallbackMode = {
            language: "text",
            name: "Plain Text",
            highlighter: "ace/mode/text",
            handlers: {},
            commands: {},
            preferences: {},
            keys: {},
            isFallback: true
        };

        var api = {
            hook: function() {
                eventbus.on("configchanged", function(config) {
                    modes = config.getModes();
                    updateAllModes();
                });
            },
            allModes: function() {
                return Object.keys(modes);
            },
            get: function(language) {
                return modes[language];
            },
            getModeForSession: function(session) {
                var filename = path.filename(session.filename);
                if (filenameMapping[filename]) {
                    return api.get(filenameMapping[filename]);
                }

                if (filename.indexOf(".") > -1) {
                    for (var i = 0; i < extensionsByLength.length; ++i) {
                        var ext = extensionsByLength[i];
                        if (endsWith(filename, "." + ext)) {
                            return api.get(extensionMapping[ext]);
                        }
                    }
                }

                var shebang_line = session.getLine(0);
                if (shebang_line.slice(0, 2) == "#!") {
                    for (var shebang in shebangMapping) {
                        if (shebang_line.indexOf(shebang) > 0) {
                            return api.get(shebangMapping[shebang]);
                        }
                    }
                }

                return fallbackMode;
            },
            setSessionMode: function(session, mode) {
                if (typeof mode === "string") {
                    mode = api.get(mode);
                }
                if (mode) {
                    session.mode = mode;
                    session.setMode(mode.highlighter);
                    session.clearAnnotations();
                    eventbus.emit("modeset", session, mode);
                }
            }
        };

        function normalizeModes() {
            _.each(modes, function(mode, name) {
                mode.language = name;

                // Normalize
                if (!mode.events) {
                    mode.events = {};
                }
                if (!mode.commands) {
                    mode.commands = {};
                }
                if (!mode.keys) {
                    mode.keys = {};
                }
                if (!mode.preferences) {
                    mode.preferences = {};
                }
                if (!mode.handlers) {
                    mode.handlers = {};
                }
            });
        }

        function updateAllModes() {
            console.log("Updating modes...");
            normalizeModes();
            updateMappings();
            eventbus.emit("modesloaded", api);
            declareAllModeCommands();
        }

        function updateMappings() {
            extensionMapping = {};
            filenameMapping = {};
            shebangMapping = {};
            _.each(modes, function(mode) {
                if (mode.extensions) {
                    mode.extensions.forEach(function(ext) {
                        extensionMapping[ext] = mode.language;
                    });
                }
                if (mode.filenames) {
                    mode.filenames.forEach(function(filename) {
                        filenameMapping[filename] = mode.language;
                    });
                }
                shebangMapping[mode.language] = mode.language;
                if (mode.shebangs) {
                    mode.shebangs.forEach(function(shebang) {
                        shebangMapping[shebang] = mode.language;
                    });
                }
            });
            extensionsByLength = Object.keys(extensionMapping).sort(longestFirst);
        }

        function declareAllModeCommands() {
            _.each(api.allModes(), function(modeName) {
                declareModeCommands(api.get(modeName));
            });
            eventbus.emit("commandsloaded");
        }

        function declareModeCommands(mode) {
            command.define("Configuration:Mode:" + mode.name, {
                exec: function(edit, session) {
                    api.setSessionMode(session, mode);
                },
                readOnly: true
            });

            _.each(mode.commands, function(cmd, name) {
                var existingCommand = command.lookup(name);

                if (!existingCommand) {
                    // Declare it as a special mode command, with an implementation
                    // specific to the mode
                    var modeCommands = {};
                    modeCommands[mode.language] = cmd;
                    var commandSpec = {
                        exec: function(edit, session, callback) {

                            var cmd = commandSpec.modeCommand[session.mode.language];
                            if (cmd) {
                                zed.getService("sandbox").execCommand(name, cmd, session, function(err, result) {
                                    if (err) {
                                        return console.error(err);
                                    }
                                    _.isFunction(callback) && callback(err, result);
                                });
                            } else {
                                if (_.isFunction(callback)) {
                                    callback("not-supported");
                                } else {
                                    eventbus.emit("sessionactivityfailed", session, "Command " + name + " not supported for this mode");
                                }
                            }
                        },
                        readOnly: true,
                        modeCommand: modeCommands
                    };
                    command.define(name, commandSpec);
                } else {
                    existingCommand.modeCommand[mode.language] = cmd;
                }
            });
        }

        register(null, {
            modes: api
        });
    }
});
