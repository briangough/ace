define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var LatexHighlightRules = require("./latex_highlight_rules").LatexHighlightRules;
var LatexFoldMode = require("./folding/latex").FoldMode;
var Range = require("../range").Range;
var WorkerClient = require("ace/worker/worker_client").WorkerClient;

var createLatexWorker = function (session) {
    var doc = session.getDocument();
    var selection = session.getSelection();

    var savedRange = {};
    var suppressions = [];
    var hints = [];
    var changeHandler = null;

    var worker = new WorkerClient(["ace"], "ace/mode/latex_worker", "LatexWorker");
    worker.attachToDocument(doc);

    // Handle cursor updates and document changes

    doc.on("change", function () {
        if(changeHandler) {
            clearTimeout(changeHandler);
            changeHandler = null;
        }
    });

    // When a character is inserted/deleted we first get a
    // changeCursor event and then an doc change event.
    //
    // If we have errors that not being shown, due to the cursor being
    // at the end of them we want to update the marker display if the
    // cursor moves.  We set a short timeout on the changeCursor event
    // and clear it on the doc change event, to avoid doing extra work
    // if the cursor move was from a change to the document.

    selection.on("changeCursor", function () {
        if(suppressions.length > 0) {
            changeHandler = setTimeout(function () {
                updateMarkers();
                suppressions = [];
                changeHandler = null;
            }, 100);
        }
    });

    // Iterate through the list of hints and find new/removed ones,
    // updating the highlight markers accordingly.

    var updateMarkers = function () {
        var annotations = [];
        var newRange = {};
        var cursor = selection.getCursor();
        suppressions = [];

        for (var i = 0; i<hints.length; i++) {
            var hint = hints[i];
            var start_row = hint.start_row;
            var start_col = hint.start_col;
            var end_row = hint.end_row;
            var end_col = hint.end_col;
            var cursorAtStart = (cursor.row === start_row && cursor.column == start_col+1);
            var cursorAtEnd = (cursor.row === end_row && (cursor.column+1) == end_col);

            // If the user is editing at the beginning or end of this error, suppress it from display
            if (hint.suppressIfEditing && (cursorAtStart || cursorAtEnd)) {
                suppressions.push({start_row: start_row, start_col: start_col,
                                   end_row:end_row, end_col:end_col});
                continue;
            }

            // Otherwise, check if this error starts inside a
            // suppressed error range (it's probably a cascading
            // error, so we hide it while the user is typing)
            var isCascadeError = false;
            for (var j = 0; j < suppressions.length; j++) {
                var badRange = suppressions[j];
                var afterStart = (start_row == badRange.start_row && start_col >= badRange.start_col);
                var beforeEnd = (start_row == badRange.end_row && start_col <= badRange.end_col);
                var insideBadRange = afterStart && beforeEnd;
                if (insideBadRange) {
                    isCascadeError = true;
                    break;
                }
            }
            // Hide cascade errors
            if(isCascadeError) {
                continue;
            };

            // Otherwise add to list of errors to display, use (start,end) as the identifier
            var key = "(" + start_row + "," + start_col + ")" + ":" + "(" + end_row + "," + end_col + ")";
            newRange[key] = hint;
            annotations.push(hint);
        }

        // Compare the errors to display with the currently displayed errors
        var changes = 0;

        // Add markers for any new errors
        for (key in newRange) {
            if (!savedRange[key]) {  // doesn't exist in already displayed errors
                var new_range = newRange[key];
                var a = doc.createAnchor(new_range.start_row, new_range.start_col);
                var b = doc.createAnchor(new_range.end_row, new_range.end_col);
                var range = new Range();
                range.start = a;
                range.end = b;
                range.id = session.addMarker(range, "ace_error-marker", "text");
                savedRange[key] = range;
                changes++;
            }
        }

        // Remove markers for any errors no longer present
        for (key in savedRange) {
            if (!newRange[key]) {  // no longer present in list of errors to display
                range = savedRange[key];
                range.start.detach();
                range.end.detach();
                session.removeMarker(range.id);
                delete savedRange[key];
                changes++;
            }
        }

        // If there were changes, also update the annotations in the margin
        if (changes>0) {
            session.setAnnotations(annotations);
        };
    };

    // Handler for results from the syntax validator
    worker.on("lint", function(results) {
        hints = results.data;
        if (hints.length > 100) {
            hints = hints.slice(0, 100); // limit to 100 errors
        };
        updateMarkers();
    });

    // Clear ranges from editor on exit
    worker.on("terminate", function() {
        for (var key in savedRange) {
            var range = savedRange[key];
            range.start.detach();
            range.end.detach();
            session.removeMarker(range.id);
            delete savedRange[key];
        }

    });

    return worker;
};

var Mode = function() {
    this.HighlightRules = LatexHighlightRules;
    this.foldingRules = new LatexFoldMode();
    this.createWorker = createLatexWorker;
};
oop.inherits(Mode, TextMode);

(function() {
    this.type = "text";

    this.lineCommentStart = "%";

    this.$id = "ace/mode/latex";
}).call(Mode.prototype);

exports.Mode = Mode;

});
