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
};

oop.inherits(LatexWorker, Mirror);

    // BEGIN PARSER

var Parse = function (text) {
    var errors = [];
    var Comments = [];
    var Tokens = [];
    var Environments = [];
    var pos = -1;
    var SPECIAL = /[\\\{\}\$\&\#\^\_\~\%]/g;  // match TeX special characters
    var CS = /[^a-zA-Z]/g;  // match characters which aren't part of a TeX control sequence
    var idx = 0;

    var lineNumber = 0;   // current line number when parsing tokens (zero-based)
    var linePosition = [];  // mapping from line number to absolute offset of line in text[]
    linePosition[0] = 0;

    // Error reporting functions for tokens and environments
    
    var TokenError = function (token, message) {
	var line = token[0], type = token[1], start = token[2], end = token[3];
	var start_col = start - linePosition[line];
	var end_col = end - linePosition[line] + 1;
	errors.push({row: line,
		     column: start_col,
		     start_row:line,
		     start_col: start_col,
		     end_row:line,
		     end_col: end_col,
		     type:"error",
		     text:message,
		     suppressIfEditing:true});
    };

    // Report an error over a range (from, to)
    
    var TokenErrorFromTo = function (fromToken, toToken, message) {
	var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3];
	var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3];
	if (!toEnd) { toEnd = toStart + 1;};
	var start_col = fromStart - linePosition[fromLine];
	var end_col = toEnd - linePosition[toLine] + 1;

	errors.push({row: line,
		     column: start_col,
		     start_row: fromLine,
		     start_col: start_col,
		     end_row: toLine,
		     end_col: end_col,
		     type:"error",
		     text:message,
		     suppressIfEditing:true});
    };


    var EnvErrorFromTo = function (fromEnv, toEnv, message, options) {
	if(!options) { options = {} ; };
	var fromToken = fromEnv.token, toToken = toEnv.closeToken || toEnv.token;
	var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3];
	if (!toToken) {toToken = fromToken;};
	var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3];
	if (!toEnd) { toEnd = toStart + 1;};
	var start_col = fromStart - linePosition[fromLine];
	var end_col = toEnd - linePosition[toLine] + 1;
	errors.push({row:toLine,
		     column:end_col,
		     start_row:fromLine,
		     start_col: start_col,
		     end_row:toLine,
		     end_col: end_col,
		     type:"error",
		     text:message,
		     suppressIfEditing:options.suppressIfEditing});
    };

    // Report an error up to a given environment (from the beginning of the document)
    
    var EnvErrorTo = function (toEnv, message) {
	var token = toEnv.closeToken || toEnv.token;
	var line = token[0], type = token[1], start = token[2], end = token[3];
	if (!end) { end = start + 1; };
	var end_col = end - linePosition[line] + 1;
	var err = {row: line,
		   column: end_col,
		   start_row:0,
		   start_col: 0,
		   end_row: line,
		   end_col: end_col,
		   type:"error",
		   text:message};
	errors.push(err);
    };

    // Report an error from a given environment (up to then end of the document)
    
    var EnvErrorFrom = function (env, message) {
	var token = env.token;
	var line = token[0], type = token[1], start = token[2], end = token[3];
	var start_col = start - linePosition[line];
	var end_col = Infinity;
	errors.push({row: line,
		     column: start_col,
		     start_row:line,
		     start_col: start_col,
		     end_row: lineNumber,
		     end_col: end_col,
		     type:"error",
		     text:message});
    };

    var checkingDisabled = false;
    var count = 0;  // number of tokens parses
    var MAX_TOKENS = 100000;

    // Main parsing loop, split into tokens on TeX special characters
    // each token is pushed onto the Tokens array as follows
    //
    // special character: [lineNumber, charCode, start]
    // control sequence:  [lineNumber, "\", start, end, "foo"]
    // control symbold:   [lineNumber, "\", start, end, "@"]
    //
    // end position = (position of last character in the sequence) + 1
    // 
    // so text.substring(start,end) returns the "foo" for \foo
    
    while (true) {
	count++;

	// Avoid infinite loops and excessively large documents
	if (count > MAX_TOKENS) {
	    throw new Error("exceed max token count of " + MAX_TOKENS);
	    break;
	};
	var result = SPECIAL.exec(text);

	// If no more special characters found, must be text at end of file
	if (result == null) {
	    if (idx < text.length) {
		Tokens.push([lineNumber, "Text", idx, text.length]);
		// FIXME: could check if previous token was Text and merge
	    }
	    break;
	}
	
	// Break out of loop if not going forwards in the file (shouldn't happen)
	if (result && result.index <= pos) {
	    throw new Error("infinite loop in parsing");
	    break;
	};

	
	// Move up to the position of the match
	pos = result.index;

	// Anything between special characters is text
	if (pos > idx) {
	    // FIXME: check if previous token was Text and merge
	    Tokens.push([lineNumber, "Text", idx, pos]);
	}

	// Scan over the text and update the line count
	for (var i = idx; i < pos; i++) {
	    if (text[i] === "\n") {
		lineNumber++;
		linePosition[lineNumber] = i+1;
	    }
	}

	var newIdx = SPECIAL.lastIndex;
	idx = newIdx;

	// Inspect the special character and consume additional characters according to TeX rules
	var code = result[0];
	if (code === "%") {
	    // Handle comments by consuming up to the next newline character
	    var newLinePos = text.indexOf("\n", idx);
	    if (newLinePos === -1) {
		// reached end of file
		newLinePos = text.length;
	    };
	    // Check comment for our magic sequences %novalidate, %begin/%end novalidate
	    var commentString = text.substring(idx, newLinePos);
	    if (commentString.indexOf("%novalidate") === 0) {
		return [];
	    } else if(!checkingDisabled && commentString.indexOf("%begin novalidate") === 0) {
		checkingDisabled = true;
	    } else if (checkingDisabled && commentString.indexOf("%end novalidate") === 0) {
		checkingDisabled = false;
	    };
	    // Update the line count
	    idx = SPECIAL.lastIndex = newLinePos + 1;
	    Comments.push([lineNumber, idx, newLinePos]);
	    lineNumber++;
	    linePosition[lineNumber] = idx;
	} else if (checkingDisabled) {
	    // do nothing
	    continue;
	} else if (code === '\\') {
	    // Handle TeX control sequences (\foo) and control symbols (\@)
	    // Look ahead to find the next character not valid in a control sequence [^a-zA-Z]
	    CS.lastIndex = idx;
	    var controlSequence = CS.exec(text);
	    var nextSpecialPos = controlSequence === null ? idx : controlSequence.index;
	    if (nextSpecialPos === idx) {
		// it's a control symbol
		Tokens.push([lineNumber, code, pos, idx + 1, text[idx]]);
		idx = SPECIAL.lastIndex = idx + 1;
		char = text[nextSpecialPos];
		// update the line number if someone typed \ at the end of a line
		if (char === '\n') { lineNumber++; linePosition[lineNumber] = nextSpecialPos;};
	    } else {
		// it's a control sequence
		Tokens.push([lineNumber, code, pos, nextSpecialPos, text.slice(idx, nextSpecialPos)]);
		// consume whitespace after a control sequence (update the line number too)
		var char;
		while ((char = text[nextSpecialPos]) === ' ' || char === '\t' || char  === '\r' || char === '\n') {
		    nextSpecialPos++;
		    if (char === '\n') { lineNumber++; linePosition[lineNumber] = nextSpecialPos;};
		}
		idx = SPECIAL.lastIndex = nextSpecialPos;
	    }
	} else if (code === "{") {  // open group
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "}") {  // close group
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "$") {  // math mode
	    if (text[idx] === "$") {
		// next character is also $ so it's an equation $$
		idx = SPECIAL.lastIndex = idx + 1;
		Tokens.push([lineNumber, "$$", pos]);
	    } else {
		// single $
		Tokens.push([lineNumber, code, pos]);
	    }
	} else if (code === "&") {  // tabalign
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "#") {  // macro parameter
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "^") {  // superscript
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "_") {  // subscript
	    Tokens.push([lineNumber, code, pos]);
	} else if (code === "~") {  // active character (space)
	    Tokens.push([lineNumber, code, pos]);
	} else {
	    throw "unrecognised character " + code;
	}
    }

    // Functions for consuming TeX arguments
    
    var read1arg = function (k) {
	// read an argument FOO to a either form of command
	// \newcommand\FOO...
	// \newcommand{\FOO}...
	
	var open = Tokens[k+1];
	var env = Tokens[k+2];
	var close = Tokens[k+3];
	var envName;

	if(open && open[1] === "\\") {
	    // plain \FOO, isn't enclosed in braces
	    envName = open[4]; // array element 4 is command sequence
	    return k + 1;
	} else if(open && open[1] === "{" && env && env[1] === "\\" && close && close[1] === "}") {
	    // argument is in braces
	    envName = env[4];
	    return k + 3; // array element 4 is command sequence
	} else {
	    // couldn't find argument
	    return null;
	}
    };

    var read1name = function (k) {
	// read an environemt name FOO in
	// \newenvironment{FOO}...

	var open = Tokens[k+1];
	var env = Tokens[k+2];
	var close = Tokens[k+3];

	if(open && open[1] === "{" && env && env[1] === "Text" && close && close[1] === "}") {
	    var envName = text.substring(env[2], env[3]);
	    return k + 3;
	} else {
	    // couldn't find environment name
	    return null;
	}
    };

    var readOptionalParams = function(k) {
	// read an optional parameter [N] where N is a number, used
	// for \newcommand{\foo}[2]... meaning 2 parameters

	var params = Tokens[k+1];

	if(params && params[1] === "Text") {
	    var paramNum = text.substring(params[2], params[3]);
	    if (paramNum.match(/^\[\d+\]$/)) {
		return k + 1; // got it
	    };
	};

	// can't find an optional parameter
	return null;
    };

    var readDefinition = function(k) {
	// read a definition as in
	// \newcommand{\FOO}{DEFN}
	// \newcommand{\FOO}   {DEF}  (optional whitespace)

	// look ahead for argument, consuming whitespace
	k = k + 1;
	var count = 0;
	var nextToken = Tokens[k];
	while (nextToken && nextToken[1] === "Text") {
	    var start = nextToken[2], end = nextToken[3];
	    for (i = start; i < end; i++) {
		var char = text[i];
		if (char === ' ' || char === '\t' || char  === '\r' || char === '\n') { continue; }
		return null; // bail out, should begin with a {
	    }
	    k++;
	    nextToken = Tokens[k];
	}

	// Now we're at the start of the actual argument
	if (nextToken && nextToken[1] === "{") {
	    count++;
	    // use simple bracket matching { } to find where the
	    // argument ends
	    while (count>0) {
		k++;
		nextToken = Tokens[k];
		if(!nextToken) { break; };
		if (nextToken[1] === "}") { count--; }
		if (nextToken[1] === "{") { count++; }
	    }
	    return k;
	}
	
	return null;
    };


    // Iterate over the tokens, looking for environments to match
    // TODO: extend to include mathmode state, and any other checks we
    // want
    //
    // Push environment command found (\begin, \end) onto the
    // Environments array. 
    
    for (var _j = 0, _len = Tokens.length; _j < _len; _j++) {
	var token = Tokens[_j];
	var line = token[0], type = token[1], start = token[2], end = token[3], seq = token[4];
	if (type === "\\") {
	    // Interpret each control sequence
	    if (seq === "begin" || seq === "end") {
		// We've got a begin or end, now look ahead at the
		// next three tokens which should be "{" "ENVNAME" "}"
		var open = Tokens[_j+1];
		var env = Tokens[_j+2];
		var close = Tokens[_j+3];
		if(open && open[1] === "{" && env && env[1] === "Text" && close && close[1] === "}") {
		    // We've got a valid environment command, push it onto the array.
		    var envName = text.substring(env[2], env[3]);
		    Environments.push({command: seq, name: envName, token: token, closeToken: close});
		    _j = _j + 3; // advance past these tokens
		} else {
		    // We're looking at an invalid environment command, read as far as we can in the sequence
		    // "{" "CHAR" "CHAR" "CHAR" ... to report an error for as much of the command as we can,
		    // bail out when we hit a space/newline.
		    var endToken = null;
		    if (open && open[1] === "{") {
			endToken = open; // we've got a {
			if (env && env[1] === "Text") {
			    endToken = env.slice(); // we've got some text following the {
			    start = endToken[2]; end = endToken[3];
			    for (i = start; i < end; i++) {
				char = text[i];
				if (char === ' ' || char === '\t' || char  === '\r' || char === '\n') { break; }
			    }
			    endToken[3] = i; // the end of partial token is as far as we got looking ahead
			};
		    };

		    if (endToken) {
			TokenErrorFromTo(token, endToken, "invalid environment command" + text.substring(token[2], endToken[3] || endToken[2]));
		    } else {
			TokenError(token, "invalid environment command");
		    };
		}
	    } else if (seq === "newcommand" || seq === "renewcommand" || seq === "def" || seq === "DeclareRobustCommand") {
		// Parse command definitions in a limited way, to
		// avoid falsely reporting errors from unmatched
		// environments in the command definition
		//
		// e.g. \newcommand{\foo}{\begin{equation}} is valid
		// and should not trigger an "unmatch environment"
		// error

		// try to read first arg \newcommand{\foo}...., advance if found
		// and otherwise bail out
		var newPos = read1arg(_j);  
		if (newPos === null) { continue; } else {_j = newPos;};

		// try to read any optional params [BAR]...., advance if found
		newPos = readOptionalParams(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};

		// try to read command defintion {....}, advance if found
		newPos = readDefinition(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};

	    } else if (seq === "newenvironment") {
		// Parse environment definitions in a limited way too
		// \newenvironment{name}[3]{open}{close}

		// try to read first arg \newcommand{\foo}...., advance if found
		// and otherwise bail out
		newPos = read1name(_j);
		if (newPos === null) { continue; } else {_j = newPos;};

		// try to read any optional params [BAR]...., advance if found
		newPos = readOptionalParams(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};

		// try to read open defintion {....}, advance if found
		newPos = readDefinition(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};

		// try to read close defintion {....}, advance if found
		newPos = readDefinition(_j);
		if (newPos === null) { /* do nothing */ } else {_j = newPos;};
	    }
	} else if (type === "{") {
	    // handle open group as a type of environment
	    Environments.push({command:"{", token:token});
	} else if (type === "}") {
	    // handle close group as a type of environment
	    Environments.push({command:"}", token:token});
	};

    }

    // Loop through the Environments array keeping track of the state,
    // pushing and popping environments onto the state[] array for each
    // \begin and \end command
    
    var state = []; 
    for (i = 0; i < Environments.length; i++) {
	var thisEnv = Environments[i];
	if(thisEnv.command === "begin" || thisEnv.command === "{") {
	    // push new environment onto stack
	    state.push(thisEnv);
	} else if (thisEnv.command === "end" || thisEnv.command === "}") {
	    // check if environment or group is closed correctly
	    var lastEnv = state.pop();
	    if (!lastEnv) {
		// unexpected close, nothing was open!
		if (thisEnv.command === "}") {
		    EnvErrorTo(thisEnv, "unexpected end group }");
		} else if (thisEnv.command === "end") {
		    EnvErrorTo(thisEnv, "unexpected \\end{" + thisEnv.name + "}");
		}
	    } else if (lastEnv.command === "{" && thisEnv.command === "}") {
		// closed group correctly
		continue; 
	    } else if (lastEnv.name === thisEnv.name) {
		// closed environment correctly
		continue; 
	    } else if (lastEnv.command === "begin" && thisEnv.command === "}") {
		// tried to close group after begin environment
		EnvErrorFromTo(lastEnv, thisEnv, "unexpected end group } after \\begin{" + lastEnv.name +"}");
		state.push(lastEnv);
	    } else if (lastEnv.command === "{" && thisEnv.command === "end") {
		// tried to close environment after open group
		EnvErrorFromTo(lastEnv, thisEnv, "unexpected \\end{" + thisEnv.name + "} inside group {", {suppressIfEditing:true});
		// discard the open group by not pushing it back on the stack
		// then retry the match for \end
		i--;
	    } else if (lastEnv.command === "begin" && thisEnv.command === "end") {
		// tried to close a different environment for the one that is open
		EnvErrorFromTo(lastEnv, thisEnv, "unexpected \\end{" + thisEnv.name + "} after \\begin{" + lastEnv.name + "}");
		// Apply some heuristics to try to minimise cascading errors
		//
		// Consider cases of
		// 1) Extra \end:      \begin{A}  \end{B}  \end{A}
		// 2) Extra \begin:    \begin{A}  \begin{B} \end{A}
		//
		// Case (1) if there is a potential match for the
		// lastEnv coming up, put lastEnv back on the stack.
		for (var j = i + 1; j < Environments.length; j++) {
		    // FIXME: could limit this scan to have shorter look ahead
		    var futureEnv = Environments[j];
		    if (futureEnv.command === "end" && futureEnv.name === lastEnv.name) {
			state.push(lastEnv);
			continue;
		    }
		}
		// Case (2) try looking back to the previous \begin,
		// if it gives a valid match, take it!
		lastEnv = state.pop();
		if(lastEnv) {
		    if (thisEnv.name === lastEnv.name) {
			//  got a match on the previous environment
			continue;
		    } else {
			state.push(lastEnv);
		    }
		}

	    }
	}
    }

    // If there is anything left in the state at this point, there
    // were unclosed environments or groups.
    while (state.length > 0) {
	thisEnv = state.pop();
	if (thisEnv.command === "{") {
	    // Note that having an unclosed group does not stop
	    // compilation in TeX but we will highlight it as an error
	    EnvErrorFrom(thisEnv, "unclosed group {");
	} else if (thisEnv.command === "begin") {
	    EnvErrorFrom(thisEnv, "unclosed environment \\begin{" + thisEnv.name + "}");
	};
    }

    return errors;
};

    // END PARSER

(function() {
    var disabled = false;

    this.onUpdate = function() {
	// bail out if we encounter any problems
	if (disabled) { return ; };

	var value = this.doc.getValue();
	var errors = [];
	try {
	    if (value)
		errors = Parse(value);
	} catch (e) {
	    // suppress any further exceptions
	    disabled = true;
	    errors = [];
	}
	this.sender.emit("lint", errors);
    };

}).call(LatexWorker.prototype);

});
