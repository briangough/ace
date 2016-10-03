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

    // BEGIN PARSER
    
var Parse = function (text) {
    var t0 = window.performance.now();
    var errors = [];
    var Comments = [];
    var Tokens = [];
    var Environments = [];
    var pos = -1;
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
	errors.push({start_row:line, start_col: start_col,  end_row:line, end_col: end_col, message:message + " " + seq});
    };

    var TokenError2 = function (fromToken, toToken, message) {
	//console.log("fromToken", fromToken, "toToken", toToken);
	var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3], fromSeq = fromToken[4];
	if (!toToken) {toToken = fromToken;};
	var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3], toSeq = toToken[4];
	if (!toEnd) { toEnd = toStart;};
    	var start_col = fromStart - linePosition[fromLine];
	var end_col = toEnd - linePosition[toLine] + 1;
	errors.push({start_row:fromLine, start_col: start_col,  end_row:toLine, end_col: end_col, message: message + " " +fromSeq +  " "+ toSeq});
    };

    var EnvError2 = function (fromEnv, toEnv, message) {
	//console.log("fromToken", fromToken, "toToken", toToken);
	var fromToken = fromEnv.token, toToken = toEnv.token;
	var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3], fromSeq = fromToken[4];
	if (!toToken) {toToken = fromToken;};
	var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3], toSeq = toToken[4];
	if (!toEnd) { toEnd = toStart;};
    	var start_col = fromStart - linePosition[fromLine];
	var end_col = toEnd - linePosition[toLine] + 1;
	errors.push({start_row:fromLine, start_col: start_col,  end_row:toLine, end_col: end_col, message:message + " " + fromSeq + " " +fromEnv.name + " " + toSeq + " " + toEnv.name});
    };

    
    var TokenErrorToEnd = function (token, message) {
	var line = token[0], type = token[1], start = token[2], end = token[3], seq = token[4];
    	var start_col = start - linePosition[line];
	var end_col = Infinity;
	errors.push({start_row:line, start_col: start_col,  end_row: lineNumber, end_col: end_col, message:message + " " + seq});
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
//	console.log("result:", result.index);
	if (result && result.index <= pos) {
	    console.log("ERROR: infinite loop");
	    break
	};
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
		//console.log("setting SPECIAL.lastIndex to CS.lastIndex", CS.lastIndex);
		idx = SPECIAL.lastIndex = idx + 1;
	    } else {
		Tokens.push([lineNumber, code, pos, nextSpecialPos, text.slice(idx, nextSpecialPos)]);
		var char;
		while ((char = text[nextSpecialPos]) === ' ' || char === '\t' || char  === '\r' || char === '\n') {
		    nextSpecialPos++;
		    if (char === '\n') { lineNumber++; linePosition[lineNumber] = nextSpecialPos;};
		}
		//console.log("setting SPECIAL.lastIndex to nextSpecialPos", nextSpecialPos);
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

    var read1arg = function (k) {
    	var open = Tokens[k+1];
	var env = Tokens[k+2];
	var close = Tokens[k+3];
	
	if(open && open[1] === "\\") {
	    var envName = open[4];
	    console.log("defining command", envName);
	    return k + 1;
	} else if(open && open[1] === "{" && env && env[1] === "\\" && close && close[1] === "}") {
	    var envName = env[4];
	    console.log("defining command", envName);
	    return k + 3;
	} else {
	    console.log("couldn't find command in", open, env, close);
	    return null;
	}
    };

    var read1name = function (k) {
    	var open = Tokens[k+1];
	var env = Tokens[k+2];
	var close = Tokens[k+3];
	
	if(open && open[1] === "{" && env && env[1] === "Text" && close && close[1] === "}") {
	    var envName = text.substring(env[2], env[3]);
	    console.log("defining environment", envName);
	    return k + 3;
	} else {
	    console.log("couldn't find environment in", open, env, close);
	    return null;
	}
    };

    

    var readOptionalParams = function(k) {
	var params = Tokens[k+1];
	console.log("parameter command look ahead", params);
	
	if(params && params[1] === "Text") {
	    var paramNum = text.substring(params[2], params[3]);
	    if (paramNum.match(/^\[\d+\]$/)) {
		console.log("defining parameters", paramNum);
		return k + 1;
	    };
	};
	return null;
    };

    var readDefinition = function(k) {
	// look ahead for argument
	k = k + 1;
	var count = 0;
	var nextToken = Tokens[k];
	while (nextToken[1] === "Text") {
	    console.log("found", nextToken[1], JSON.stringify(text.substring(nextToken[2], nextToken[3])));
	    var start = nextToken[2], end = nextToken[3];
	    for (i = start; i < end; i++) {
		var char = text[i];
		if (char === ' ' || char === '\t' || char  === '\r' || char === '\n') { continue; }
		console.log("non-whitespace in definition");
		return null;
	    }
	    k++;
	    nextToken = Tokens[k];
	}
	console.log("nextToken", k, nextToken);
	if (nextToken[1] === "{") {
	    count++;
	    console.log("lookahead", k, count, nextToken);
	    while (count>0) {
		k++;
		nextToken = Tokens[k];
		console.log("inner lookahead", k, count, nextToken);
		if (nextToken[1] === "}") { count--; }
		if (nextToken[1] === "{") { count++; }
	    }
	    return k;
	    console.log ("skipping ahead to", _j);
	}
	return null;
    };
    
    for (var _j = 0, _len = Tokens.length; _j < _len; _j++) {
	var token = Tokens[_j];
	var line = token[0], type = token[1], start = token[2], end = token[3], seq = token[4];
	console.log("Token", _j, token);
	if (type === "\\") {
	    if (seq === "begin" || seq === "end") {
		var open = Tokens[_j+1];
		var env = Tokens[_j+2];
		var close = Tokens[_j+3];
		if(open && open[1] === "{" && env && env[1] === "Text" && close && close[1] === "}") {
		    var envName = text.substring(env[2], env[3]);
		    Environments.push({command: seq, name: envName, token: token, closeToken: close});
		    _j = _j + 3; // advance past these tokens
		} else {
		    TokenError(token, "invalid environment command");
		}
	    } else if (seq === "newcommand" || seq === "renewcommand" || seq === "def" || seq === "DeclareRobustCommand") {
		console.log("new command look ahead");

		newPos = read1arg(_j);
		if (newPos === null) { continue; } else {_j = newPos;};

		newPos = readOptionalParams(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};

		newPos = readDefinition(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};
		
	    } else if (seq === "newenvironment") {
		// \newenvironment{name}[3]{open}{close}
		console.log("new environment look ahead");
		
		newPos = read1name(_j);
		if (newPos === null) { continue; } else {_j = newPos;};

		newPos = readOptionalParams(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};

		newPos = readDefinition(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};

		newPos = readDefinition(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};
	    }
	} else if (type === "{") {
	    Environments.push({command:"{", token:token});
	} else if (type === "}") {
	    Environments.push({command:"}", token:token});
	};
	
	if ((start != null) && (end != null) && (seq != null)) {
	    console.log(line, type, start, end, seq, JSON.stringify(text.slice(start, end)));
	} else if ((start != null) && (end != null)) {
	    console.log(line, type, start, end, JSON.stringify(text.slice(start, end)));
	} else if (start != null) {
	    console.log(line, type, start, JSON.stringify(text[start]));
	} else {
	    console.log("UNKNOWN", token);
	}
    }

    var state = [];
    for (i = 0; i < Environments.length; i++) {
	var thisEnv = Environments[i];
	console.log("checking env", thisEnv);
	if(thisEnv.command === "begin" || thisEnv.command === "{") {
	    state.push(thisEnv);
	} else if (thisEnv.command === "end" || thisEnv.command === "}") {
	    var lastEnv = state.pop();
	    console.log("lastEnv", lastEnv);
	    if (!lastEnv) {
		console.log("lastEnv is undefined");
	    } else if (lastEnv.command === "{" && thisEnv.command === "}") {
		console.log("closed scope correctly");
		continue; // closed scope correctly
	    } else  if (lastEnv.name === thisEnv.name) {
		console.log("closed environment correctly");
		continue; // closed environment correctly
	    } else if (thisEnv.command === "}") {
		EnvError2(lastEnv, thisEnv, "environment mismatch on }");
		state.push(lastEnv);
	    } else {
		EnvError2(lastEnv, thisEnv, "environment mismatch on closing " + thisEnv.name + " from open " + lastEnv.name);
		lastEnv = state.pop();
		//console.log("popped lastEnv to look at it", lastEnv);
		if(lastEnv && thisEnv.name !== lastEnv.name) {
		    //console.log("pushed lastEnv back");
		    state.push(lastEnv);
		};
	    }	
	}
	console.log("-----");
    }

    var remaining;
    while (state.length > 0) {
	//console.log("remaining", state.length);
	remaining = state.pop();
	TokenErrorToEnd(remaining.token, "unclosed environment");
    }
	    
    var t1 = window.performance.now();
    //console.log ("parsing time", t1-t0);
    return errors;
};

    // END PARSER
    
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
