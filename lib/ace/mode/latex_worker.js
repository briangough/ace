/* ***** BEGIN LICENSE BLOCK *****
 *
 * Copyright (c) 2016 ShareLaTeX
 * All rights reserved.
 * 
 * ***** END LICENSE BLOCK ***** */

define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var Mirror = require("../worker/mirror").Mirror;

var LatexWorker = exports.LatexWorker = function(sender) {
    Mirror.call(this, sender);
    this.setTimeout(250);
    //this.setOptions();
};

oop.inherits(LatexWorker, Mirror);

var Parse = function (text) {
    var t0 = window.performance.now();
    var errors = [];
    var Comments = [];
    var Tokens = [];
    var Environments = [];
    var pos = 0;
    var SPECIAL = /[\\\{\}\$\&\#\^\_\~\%]/g;
    var CS = /[^a-zA-Z]/g;
    var idx = 0;
    var lineNumber = 0;
    var linePosition = [];
    linePosition[0] = 0;

    var TokenError = function (token, message) {
	var line = token[0], type = token[1], start = token[2], end = token[3], seq = token[4];
    	var start_col = start - linePosition[line];
	var end_col = end - linePosition[line] + 1;
	errors.push({start_row:line, start_col: start_col,  end_row:line, end_col: end_col});
    };

    var TokenError2 = function (fromToken, toToken, message) {
	//console.log("fromToken", fromToken, "toToken", toToken);
	var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3];
	if (!toToken) {toToken = fromToken;};
	var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3];
	if (!toEnd) { toEnd = toStart;};
    	var start_col = fromStart - linePosition[fromLine];
	var end_col = toEnd - linePosition[toLine] + 1;
	errors.push({start_row:fromLine, start_col: start_col,  end_row:toLine, end_col: end_col});
    };

    var TokenErrorToEnd = function (token, message) {
	var line = token[0], type = token[1], start = token[2], end = token[3], seq = token[4];
    	var start_col = start - linePosition[line];
	var end_col = Infinity;
	errors.push({start_row:line, start_col: start_col,  end_row: lineNumber, end_col: end_col});
    };
    
    while (true) {
	var result = SPECIAL.exec(text);
	if (result == null) {
	    if (idx < text.length) {
		// check if previous token was Text and merge
		Tokens.push([lineNumber, "Text", idx, text.length]);
	    }
	    break;
	}
	pos = result.index;
	var newIdx = SPECIAL.lastIndex;
	if (pos > idx) {
	    // check if previous token was Text and merge
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
	    if (newLinePos === -1) {
		// reached end of file
		newLinePos = text.length;
	    };
	    idx = SPECIAL.lastIndex = newLinePos + 1;
	    Comments.push([lineNumber, idx, newLinePos]);
	    lineNumber++;
	    linePosition[lineNumber] = idx;
	} else if (code === '\\') {
	    CS.lastIndex = idx;
	    var controlSequence = CS.exec(text);
	    var nextSpecialPos = controlSequence === null ? idx : controlSequence.index;
	    if (nextSpecialPos === idx) {
		Tokens.push([lineNumber, code, pos, idx+1, text[idx]]);
		idx = SPECIAL.lastIndex = CS.lastIndex;
	    } else {
		Tokens.push([lineNumber, code, pos, nextSpecialPos, text.slice(idx, nextSpecialPos)]);
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
	    //TokenError(token, "test error");
	    if (seq === "begin" || seq === "end") {
		var open = Tokens[_j+1];
		var env = Tokens[_j+2];
		var close = Tokens[_j+3];
		if(open && open[1] === "{" && env && env[1] === "Text" && close && close[1] === "}") {
		    var envName = text.substring(env[2], env[3]);
		    Environments.push({command: seq, name: envName, token: token, closeToken: close});
		} else {
		    TokenError(token, "invalid environment command");
		}
	    };
	} else if (type === "{") {
	    Environments.push({command:"{", token:token});
	} else if (type === "}") {
	    Environments.push({command:"}", token:token});
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

    var state = [];
    for (i = 0; i < Environments.length; i++) {
	var thisEnv = Environments[i];
	//console.log("env", thisEnv);
	if(thisEnv.command === "begin" || thisEnv.command === "{") {
	    state.push(thisEnv);
	} else if (thisEnv.command === "end" || thisEnv.command === "}") {
	    var lastEnv = state.pop();
	    //console.log("lastEnv", lastEnv);
	    if (!lastEnv) {
		//console.log("lastEnv undefined");
	    } else if (lastEnv.command === "{" && thisEnv.command === "}") {
		continue; // closed scope correctly
	    } else  if (lastEnv.name === thisEnv.name) {
		continue; // closed environment correctly
	    } else if (thisEnv.command === "}") {
		TokenError2(lastEnv.token, thisEnv.token, "environment mismatch");
		state.push(lastEnv);
	    } else {
		TokenError2(lastEnv.token, thisEnv.closeToken, "environment mismatch");
		lastEnv = state.pop();
		//console.log("popped lastEnv to look at it", lastEnv);
		if(lastEnv && thisEnv.name !== lastEnv.name) {
		    //console.log("pushed lastEnv back");
		    state.push(lastEnv);
		};
	    }	
	}
    }

    var remaining;
    while (state.length > 0) {
	//console.log("remaining", state.length);
	remaining = state.pop();
	TokenErrorToEnd(remaining.token, "unclosed environment");
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
