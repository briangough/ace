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
    this.setTimeout(5000);
    //this.setOptions();
};

oop.inherits(LatexWorker, Mirror);

var Parse = function (text) {
    var t0 = window.performance.now();
    var errors = [];
    var Comments = [];
    var Tokens = [];
    var pos = 0;
    var SPECIAL = /[\\\{\}\$\&\#\^\_\~\%]/g;
    var CS = /[^a-zA-Z]/g;
    var idx = 0;
    var lineNumber = 0;
    var linePosition = [];
    linePosition[0] = 0;

    while (true) {
	var result = SPECIAL.exec(text);
	if (result == null) {
	    if (idx < text.length) {
		Tokens.push([lineNumber, "Text", idx, text.length]);
	    }
	    break;
	}
	pos = result.index;
	var newIdx = SPECIAL.lastIndex;
	if (pos > idx) {
	    Tokens.push([lineNumber, "Text", idx, pos]);
	}
	for (var i = idx; i < pos; i++) {
	    if (text[i] === "\n") {
		lineNumber++;
		linePosition[lineNumber] = i+1;
	    }
	}
	idx = newIdx;
	var code = result[0];
	if (code === "%") {
	    var newLinePos = text.indexOf("\n", idx);
	    idx = SPECIAL.lastIndex = newLinePos + 1;
	    Comments.push([lineNumber, idx, newLinePos]);
	    lineNumber++;
	    linePosition[lineNumber] = idx;
	} else if (code === '\\') {
	    CS.lastIndex = idx;
	    var controlSequence = CS.exec(text);
	    var nextSpecialPos = controlSequence === null ? idx : controlSequence.index;
	    if (nextSpecialPos === idx) {
		Tokens.push([lineNumber, code, idx, idx+1, text[idx]]);
		idx = SPECIAL.lastIndex = CS.lastIndex;
	    } else {
		Tokens.push([lineNumber, code, idx, nextSpecialPos, text.slice(idx, nextSpecialPos)]);
		var char;
		while ((char = text[nextSpecialPos]) === ' ' || char === '\t' || char  === '\r' || char === '\n') {
		    nextSpecialPos++;
		    if (char === '\n') { lineNumber++; linePosition[lineNumber] = nextSpecialPos;};
		}
		idx = SPECIAL.lastIndex = nextSpecialPos;
	    }
	} else if (code === "{") {
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "}") {
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "$") {
	    if (text[idx] === "$") {
		idx = SPECIAL.lastIndex = idx + 1;
		Tokens.push([lineNumber, "$$", pos]);
	    } else {
		Tokens.push([lineNumber, code, pos]);
	    }
	} else if (code === "&") {
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "#") {
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "^") {
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "_") {
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "~") {
	    Tokens.push([lineNumber, code, pos]);
	} else {
	    throw "unrecognised character " + code;
	}
    }

    for (var _j = 0, _len = Tokens.length; _j < _len; _j++) {
	var token = Tokens[_j];
	var line = token[0], type = token[1], start = token[2], end = token[3], seq = token[4];
	if (type === "\\") {
	    var start_col = start - linePosition[line];
	    var end_col = end - linePosition[line];
	    errors.push({start_row:line, start_col: start_col,  end_row:line, end_col: end_col});
	};
	if ((start != null) && (end != null) && (seq != null)) {
	    //console.log(line, type, start, end, seq, JSON.stringify(text.slice(start, end)));
	} else if ((start != null) && (end != null)) {
	    //console.log(line, type, start, end, JSON.stringify(text.slice(start, end)));
	} else if (start != null) {
	    //console.log(line, type, start, JSON.stringify(text[start]));
	} else {
	    //console.log("UNKNOWN", token);
	}
    }

    var t1 = window.performance.now();
    console.log ("parsing time", t1-t0);
    return errors;
};

    
(function() {

    this.onUpdate = function() {
        var value = this.doc.getValue();
        var errors = [];

//	try {
            if (value)
                errors = Parse(value);
//        } catch (e) {
	    // suppress exceptions
//	    console.log("latex worker error",e);
//        }
        this.sender.emit("lint", errors);
    };

}).call(LatexWorker.prototype);

});
