/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var Mirror = require("../worker/mirror").Mirror;

var LatexWorker = exports.LatexWorker = function(sender) {
    Mirror.call(this, sender);
    this.setTimeout(500);
    //this.setOptions();
};

oop.inherits(LatexWorker, Mirror);

var Parse = function (text) {
    //console.log ("text", typeof text);
    var lines = text.split('\n');
    //console.log ("lines", lines.length);
    var state = [], errors = [];
    var i;
    for (i = 0; i < lines.length; i++) {
	var line = lines[i];
	var result;
	var error = null;
	var regex = /\\(begin|end)\{(\w+\*?)\}/g;
	var result;
	while (result = regex.exec(line)) {
	    var type = result[1];
	    var env = result[2];
	    //console.log ("match", result[1], result[2]);
	    if (type == "begin") {
		state.push({"env":env, "row": i});
		//console.log ("state is now", state);
	    } else if (type == "end") {
		//console.log ("matched end", type, env);
		var last_open = state.pop();
		//console.log ("checking last open against current", last_open, env);
		if (last_open &&  last_open.env == env) {
		    //console.log("matched begin", last_open.env, "with end", env);
		} else if (last_open && last_open.env != env) {
		    error = {"type":"info", "text": "end " + env + "with begin " + last_open.env, "start_row": last_open.row, "end_row":i };
		} else if (!last_open) {
		    error = {"type":"info", "text": "end without begin " + type, "start_row": 0, "end_row": i};
		}
	    };
	};
	if (error) {
	    errors.push(error);
	};

    };
    //console.log("final state", state);
    if (state.length > 0) {
	for (i = 0; i < state.length; i++) {
	    var unclosed = state[i];
	    error = {"type":"info", "text": "begin without end " + unclosed.type, "start_row": unclosed.row, "end_row": lines.length-1};
	    errors.push(error);
	};
    };
    if (errors.length) {
	return [errors[0]];
    }; 
    return errors;
};

    
(function() {

    
    this.onUpdate = function() {
        var value = this.doc.getValue();
        var errors = [];

	try {
            if (value)
                errors = Parse(value);
        } catch (e) {
	    // suppress exceptions
        }
        this.sender.emit("lint", errors);
    };

}).call(LatexWorker.prototype);

});
