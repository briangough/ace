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

var Tokenise = function (text) {
    var Tokens = [];
    var Comments = [];
    var pos = -1;
    var SPECIAL = /[\\\{\}\$\&\#\^\_\~\%]/g;  // match TeX special characters
    var NEXTCS = /[^a-zA-Z]/g;  // match characters which aren't part of a TeX control sequence
    var idx = 0;

    var lineNumber = 0;   // current line number when parsing tokens (zero-based)
    var linePosition = [];  // mapping from line number to absolute offset of line in text[]
    linePosition[0] = 0;

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
        if (code === "%") { // comment character
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
        } else if (code === '\\') { // escape character
            // Handle TeX control sequences (\foo) and control symbols (\@)
            // Look ahead to find the next character not valid in a control sequence [^a-zA-Z]
            NEXTCS.lastIndex = idx;
            var controlSequence = NEXTCS.exec(text);
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

    return {tokens: Tokens, comments: Comments, linePosition: linePosition, lineNumber: lineNumber, text: text};
};

// Functions for consuming TeX arguments

var read1arg = function (TokeniseResult, k, options) {
    // read an argument FOO to a either form of command
    // \newcommand\FOO...
    // \newcommand{\FOO}...
    // Also support \newcommand*
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    // check for optional * like \newcommand*
    if (options && options.allowStar) {
        var optional = Tokens[k+1];
        if (optional && optional[1] === "Text") {
            var optionalstr = text.substring(optional[2], optional[3]);
            if (optionalstr === "*") { k++;}
        };
    };

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
        envName = env[4]; // NOTE: if we were actually using this, keep track of * above
        return k + 3; // array element 4 is command sequence
    } else {
        // couldn't find argument
        return null;
    }
};


var read1name = function (TokeniseResult, k) {
    // read an environemt name FOO in
    // \newenvironment{FOO}...
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var open = Tokens[k+1];
    var env = Tokens[k+2];
    var close = Tokens[k+3];

    if(open && open[1] === "{" && env && env[1] === "Text" && close && close[1] === "}") {
        var envName = text.substring(env[2], env[3]);
        return k + 3;
    } else if (open && open[1] === "{" && env && env[1] === "Text") {
        // handle names like FOO_BAR
        envName = "";
        for (var j = k + 2, tok; (tok = Tokens[j]); j++) {
            if (tok[1] === "Text") {
                var str = text.substring(tok[2], tok[3]);
                if (!str.match(/^\S*$/)) { break; }
                envName = envName + str;
            } else if (tok[1] === "_") {
                envName = envName + "_";
            } else {
                break;
            }
        }
        if (tok && tok[1] === "}") {
            return  j; // advance past these tokens
        } else {
            return null;
        }
    } else {
        // couldn't find environment name
        return null;
    }
};

var readOptionalParams = function(TokeniseResult, k) {
    // read an optional parameter [N] where N is a number, used
    // for \newcommand{\foo}[2]... meaning 2 parameters
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var params = Tokens[k+1];

    if(params && params[1] === "Text") {
        var paramNum = text.substring(params[2], params[3]);
        if (paramNum.match(/^\[\d+\](\[[^\]]*\])*\s*$/)) {
            return k + 1; // got it
        };
    };

    // can't find an optional parameter
    return null;
};

var readDefinition = function(TokeniseResult, k) {
    // read a definition as in
    // \newcommand{\FOO}{DEFN}
    // \newcommand{\FOO}   {DEF}  (optional whitespace)
    // look ahead for argument, consuming whitespace
    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    k = k + 1;
    var count = 0;
    var nextToken = Tokens[k];
    while (nextToken && nextToken[1] === "Text") {
        var start = nextToken[2], end = nextToken[3];
        for (var i = start; i < end; i++) {
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

var readVerb = function(TokeniseResult, k) {
    // read a verbatim argument
    // \verb@foo@
    // \verb*@foo@
    // where @ is any character except * for \verb
    // foo is any sequence excluding end-of-line and the delimiter
    // a space does work for @, contrary to latex documentation

    // Note: this is only an approximation, because we have already
    // tokenised the input stream, and we should really do that taking
    // into account the effect of verb.  For example \verb|%| will get
    // confused because % is then a character.

    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var verbToken = Tokens[k];
    var verbStr = text.substring(verbToken[2], verbToken[3]);

    // start looking at text immediately after \verb command
    var pos = verbToken[3];
    if (text[pos] === "*") { pos++; } // \verb* form of command
    var delimiter = text[pos];
    pos++;

    var nextToken = Tokens[k+1];
    for (var i = pos, end = text.length; i < end; i++) {
        var char = text[i];
        if (nextToken && i >= nextToken[2]) { k++; nextToken = Tokens[k+1];};
        if (char === delimiter) { return k; };
        if (char  === '\r' || char === '\n') { return null; }
    };

    return null;
};

var readUrl = function(TokeniseResult, k) {
    // read a url argument
    // \url|foo|
    // \url{foo}

    // Note: this is only an approximation, because we have already
    // tokenised the input stream.

    var Tokens = TokeniseResult.tokens;
    var text = TokeniseResult.text;

    var urlToken = Tokens[k];
    var urlStr = text.substring(urlToken[2], urlToken[3]);

    // start looking at text immediately after \url command
    var pos = urlToken[3];
    var openDelimiter = text[pos];
    var closeDelimiter =  (openDelimiter === "{") ? "}" : openDelimiter;

    // Was the delimiter a token? if so, advance token index
    var nextToken = Tokens[k+1];
    if (nextToken && pos === nextToken[2]) {
        k++;
        nextToken = Tokens[k+1];
    };

    // Now start looking at the enclosed text
    pos++;

    var count = 1;
    for (var i = pos, end = text.length; count > 0 && i < end; i++) {
        var char = text[i];
        if (nextToken && i >= nextToken[2]) { k++; nextToken = Tokens[k+1];};
        if (char === closeDelimiter) {
            count--;
        } else if (char === openDelimiter) {
            count++;
        };
        if (count === 0) { return k; };
        if (char  === '\r' || char === '\n') { return null; }
    };

    return null;
};


var InterpretTokens = function (TokeniseResult, ErrorReporter) {
    var Tokens = TokeniseResult.tokens;
    var linePosition = TokeniseResult.linePosition;
    var lineNumber = TokeniseResult.lineNumber;
    var text = TokeniseResult.text;

    var TokenErrorFromTo = ErrorReporter.TokenErrorFromTo;
    var TokenError = ErrorReporter.TokenError;
    var Environments = [];

    // Iterate over the tokens, looking for environments to match
    // TODO: extend to include mathmode state, and any other checks we
    // want
    //
    // Push environment command found (\begin, \end) onto the
    // Environments array.

    for (var i = 0, len = Tokens.length; i < len; i++) {
        var token = Tokens[i];
        var line = token[0], type = token[1], start = token[2], end = token[3], seq = token[4];
        if (type === "\\") {
            // Interpret each control sequence
            if (seq === "begin" || seq === "end") {
                // We've got a begin or end, now look ahead at the
                // next three tokens which should be "{" "ENVNAME" "}"
                var open = Tokens[i+1];
                var env = Tokens[i+2];
                var close = Tokens[i+3];
                if(open && open[1] === "{" && env && env[1] === "Text" && close && close[1] === "}") {
                    // We've got a valid environment command, push it onto the array.
                    var envName = text.substring(env[2], env[3]);
                    Environments.push({command: seq, name: envName, token: token, closeToken: close});
                    i = i + 3; // advance past these tokens
                } else {
                    // Check for an environment command like \begin{new_major_theorem}
                    if (open && open[1] === "{" && env && env[1] === "Text") {
                        envName = "";
                        for (var j = i + 2, tok; (tok = Tokens[j]); j++) {
                            if (tok[1] === "Text") {
                                var str = text.substring(tok[2], tok[3]);
                                if (!str.match(/^\S*$/)) { break; }
                                envName = envName + str;
                            } else if (tok[1] === "_") {
                                envName = envName + "_";
                            } else {
                                break;
                            }
                        }
                        if (tok && tok[1] === "}") {
                            Environments.push({command: seq, name: envName, token: token, closeToken: close});
                            i = j; // advance past these tokens
                            continue;
                        }
                    }

                    // We're looking at an invalid environment command, read as far as we can in the sequence
                    // "{" "CHAR" "CHAR" "CHAR" ... to report an error for as much of the command as we can,
                    // bail out when we hit a space/newline.
                    var endToken = null;
                    if (open && open[1] === "{") {
                        endToken = open; // we've got a {
                        if (env && env[1] === "Text") {
                            endToken = env.slice(); // we've got some text following the {
                            start = endToken[2]; end = endToken[3];
                            for (j = start; j < end; j++) {
                                var char = text[j];
                                if (char === ' ' || char === '\t' || char  === '\r' || char === '\n') { break; }
                            }
                            endToken[3] = j; // the end of partial token is as far as we got looking ahead
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
                var newPos = read1arg(TokeniseResult, i, {allowStar: (seq != "def")});
                if (newPos === null) { continue; } else {i = newPos;};

                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalParams(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read command defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

            } else if (seq === "newcolumntype") {
                // try to read first arg \newcolumntype{T}...., advance if found
                // and otherwise bail out
                newPos = read1name(TokeniseResult, i);
                if (newPos === null) { continue; } else {i = newPos;};

                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalParams(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read command defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

            } else if (seq === "newenvironment" || seq === "renewenvironment") {
                // Parse environment definitions in a limited way too
                // \newenvironment{name}[3]{open}{close}

                // try to read first arg \newcommand{\foo}...., advance if found
                // and otherwise bail out
                newPos = read1name(TokeniseResult, i);
                if (newPos === null) { continue; } else {i = newPos;};

                // try to read any optional params [BAR]...., advance if found
                newPos = readOptionalParams(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read open defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};

                // try to read close defintion {....}, advance if found
                newPos = readDefinition(TokeniseResult, i);
                if (newPos === null) { /* do nothing */ } else {i = newPos;};
            } else if (seq === "verb") {
                // \verb|....|  where | = any char
                newPos = readVerb(TokeniseResult, i);
                if (newPos === null) { TokenError(token, "invalid verbatim command"); } else {i = newPos;};
            } else if (seq === "url") {
                // \url{...} or \url|....|  where | = any char
                newPos = readUrl(TokeniseResult, i);
                if (newPos === null) { TokenError(token, "invalid url command"); } else {i = newPos;};
            }
        } else if (type === "{") {
            // handle open group as a type of environment
            Environments.push({command:"{", token:token});
        } else if (type === "}") {
            // handle close group as a type of environment
            Environments.push({command:"}", token:token});
        };
    };
    return Environments;
};


var CheckEnvironments = function (Environments, ErrorReporter) {
    // Loop through the Environments array keeping track of the state,
    // pushing and popping environments onto the state[] array for each
    // \begin and \end command
    var ErrorTo = ErrorReporter.EnvErrorTo;
    var ErrorFromTo = ErrorReporter.EnvErrorFromTo;
    var ErrorFrom = ErrorReporter.EnvErrorFrom;

    var state = [];
    var documentClosed = null;
    var inVerbatim = false;
    var verbatimRanges = [];

    // flag any verbatim environments for special handling
    for (var i = 0, len = Environments.length; i < len; i++) {
        var name = Environments[i].name ;
        if (name && name.match(/^(verbatim|boxedverbatim|lstlisting)$/)) {
            Environments[i].verbatim = true;
        }
    }

    // now check all the environments
    for (i = 0, len = Environments.length; i < len; i++) {
        var thisEnv = Environments[i];
        if(thisEnv.command === "begin" || thisEnv.command === "{") {
            if (inVerbatim) { continue; } // ignore anything in verbatim environments
            // push new environment onto stack
            if (thisEnv.verbatim) {inVerbatim = true;};
            state.push(thisEnv);
        } else if (thisEnv.command === "end" || thisEnv.command === "}") {
            // check if environment or group is closed correctly
            var lastEnv = state.pop();

            if (inVerbatim) {
                if (lastEnv && lastEnv.name === thisEnv.name) {
                    // closed verbatim environment correctly
                    inVerbatim = false;
                    // keep track of all the verbatim ranges to filter out errors
                    verbatimRanges.push({start: lastEnv.token[2], end: thisEnv.token[2]});
                    continue;
                } else {
                    if(lastEnv) { state.push(lastEnv); } ;
                    continue;  // ignore all other commands
                }
            };

            if (lastEnv && lastEnv.command === "{" && thisEnv.command === "}") {
                // closed group correctly
                continue;
            } else if (lastEnv && lastEnv.name === thisEnv.name) {
                // closed environment correctly
                if (thisEnv.name === "document" && !documentClosed) {
                    documentClosed = thisEnv;
                };
                continue;
            } else if (!lastEnv) {
                // unexpected close, nothing was open!
                if (thisEnv.command === "}") {
                    if (documentClosed) {
                        ErrorFromTo(documentClosed, thisEnv, "\\end{" + documentClosed.name + "} is followed by unexpected end group }",{errorAtStart: true, type: "info"});
                    } else {
                        ErrorTo(thisEnv, "unexpected end group }");
                    };
                } else if (thisEnv.command === "end") {
                    if (documentClosed) {
                        ErrorFromTo(documentClosed, thisEnv, "\\end{" + documentClosed.name + "} is followed by unexpected content",{errorAtStart: true, type: "info"});
                    } else {
                        ErrorTo(thisEnv, "unexpected \\end{" + thisEnv.name + "}");
                    }
                }
            } else if (lastEnv.command === "begin" && thisEnv.command === "}") {
                // tried to close group after begin environment
                ErrorFromTo(lastEnv, thisEnv, "unexpected end group } after \\begin{" + lastEnv.name +"}");
                state.push(lastEnv);
            } else if (lastEnv.command === "{" && thisEnv.command === "end") {
                // tried to close environment after open group
                ErrorFromTo(lastEnv, thisEnv,
                            "unclosed group { found at \\end{" + thisEnv.name + "}",
                            {suppressIfEditing:true, errorAtStart: true});
                // discard the open group by not pushing it back on the stack
                // then retry the match for \end
                i--;
            } else if (lastEnv.command === "begin" && thisEnv.command === "end") {
                // tried to close a different environment for the one that is open
                // Basic question:  was there an extra \begin earlier or is this an extra \end?
                // Error message could be
                //      "unclosed \begin{A} found at \end{B}"
                // or   "unexpected \end{B} found"
                ErrorFromTo(lastEnv, thisEnv,
                            "unclosed \\begin{" + lastEnv.name + "} found at \\end{" + thisEnv.name + "} " ,
                            {errorAtStart: true});
                // Apply some heuristics to try to minimise cascading errors
                //
                // Consider cases of
                // 1) Extra \end:      \begin{A}  \end{B}  \end{A}
                // 2) Extra \begin:    \begin{A}  \begin{B} \end{A}
                //
                // Case (1) if there is a potential match for the
                // lastEnv coming up, put lastEnv back on the stack.
                for (var j = i + 1; j < len; j++) {
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
            ErrorFrom(thisEnv, "unclosed group {");
        } else if (thisEnv.command === "begin") {
            ErrorFrom(thisEnv, "unclosed environment \\begin{" + thisEnv.name + "}");
        };
    }

    // Filter out any token errors inside verbatim environments
    var vlen = verbatimRanges.length;
    len = ErrorReporter.tokenErrors.length;
    if (vlen >0 && len > 0) {
        for (i = 0; i < len; i++) {
            var tokenError = ErrorReporter.tokenErrors[i];
            var startPos = tokenError.startPos;
            var endPos = tokenError.endPos;
            for (j = 0; j < vlen; j++) {
                if (startPos > verbatimRanges[j].start && startPos < verbatimRanges[j].end) {
                    tokenError.ignore = true;
                    break;
                }
            }
        }
    }

};

// Error reporting functions for tokens and environments
var ErrorReporter = function (TokeniseResult) {
    var text = TokeniseResult.text;
    var linePosition = TokeniseResult.linePosition;
    var lineNumber = TokeniseResult.lineNumber;

    var errors = [], tokenErrors = [];
    this.errors = errors;
    this.tokenErrors = tokenErrors;

    this.getErrors = function () {
        var returnedErrors = [];
        for (var i = 0, len = tokenErrors.length; i < len; i++) {
            if (!tokenErrors[i].ignore) { returnedErrors.push(tokenErrors[i]); }
        }
        return returnedErrors.concat(errors);
    };

    this.TokenError = function (token, message) {
        var line = token[0], type = token[1], start = token[2], end = token[3];
        var start_col = start - linePosition[line];
        var end_col = end - linePosition[line];
        tokenErrors.push({row: line,
                          column: start_col,
                          start_row:line,
                          start_col: start_col,
                          end_row:line,
                          end_col: end_col,
                          type:"error",
                          text:message,
                          startPos: start,
                          endPos: end,
                          suppressIfEditing:true});
    };

    // Report an error over a range (from, to)

    this.TokenErrorFromTo = function (fromToken, toToken, message) {
        var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3];
        var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3];
        if (!toEnd) { toEnd = toStart + 1;};
        var start_col = fromStart - linePosition[fromLine];
        var end_col = toEnd - linePosition[toLine];

        tokenErrors.push({row: fromLine,
                          column: start_col,
                          start_row: fromLine,
                          start_col: start_col,
                          end_row: toLine,
                          end_col: end_col,
                          type:"error",
                          text:message,
                          startPos: fromStart,
                          endPos: toEnd,
                          suppressIfEditing:true});
    };


    this.EnvErrorFromTo = function (fromEnv, toEnv, message, options) {
        if(!options) { options = {} ; };
        var fromToken = fromEnv.token, toToken = toEnv.closeToken || toEnv.token;
        var fromLine = fromToken[0], fromStart = fromToken[2], fromEnd = fromToken[3];
        if (!toToken) {toToken = fromToken;};
        var toLine = toToken[0], toStart = toToken[2], toEnd = toToken[3];
        if (!toEnd) { toEnd = toStart + 1;};
        var start_col = fromStart - linePosition[fromLine];
        var end_col = toEnd - linePosition[toLine];
        errors.push({row: options.errorAtStart ? fromLine : toLine,
                     column: options.errorAtStart ? start_col: end_col,
                     start_row:fromLine,
                     start_col: start_col,
                     end_row:toLine,
                     end_col: end_col,
                     type: options.type ? options.type : "error",
                     text:message,
                     suppressIfEditing:options.suppressIfEditing});
    };

    // Report an error up to a given environment (from the beginning of the document)

    this.EnvErrorTo = function (toEnv, message) {
        var token = toEnv.closeToken || toEnv.token;
        var line = token[0], type = token[1], start = token[2], end = token[3];
        if (!end) { end = start + 1; };
        var end_col = end - linePosition[line];
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

    this.EnvErrorFrom = function (env, message) {
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
};

var Parse = function (text) {
    var TokeniseResult = Tokenise(text);
    var Reporter = new ErrorReporter(TokeniseResult);
    var Environments = InterpretTokens(TokeniseResult, Reporter);
    CheckEnvironments(Environments, Reporter);
    return Reporter.getErrors();
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
