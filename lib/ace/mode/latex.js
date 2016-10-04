define(function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var LatexHighlightRules = require("./latex_highlight_rules").LatexHighlightRules;
var LatexFoldMode = require("./folding/latex").FoldMode;
var Range = require("../range").Range;
var WorkerClient = require("ace/worker/worker_client").WorkerClient;


var Mode = function() {
    this.HighlightRules = LatexHighlightRules;
    this.foldingRules = new LatexFoldMode();
    this.createWorker = function(session) {
	var doc = session.getDocument();
	var selection = session.getSelection();

	var savedRange = {};
	var suppressions = [];
	var hints = [];
	var changeHandler = null;

	var worker = new WorkerClient(["ace"], "ace/mode/latex_worker", "LatexWorker");
	worker.attachToDocument(doc);

	doc.on("change", function () {
	    if(changeHandler) {
		clearTimeout(changeHandler);
		changeHandler = null;
	    }
	});

	selection.on("changeCursor", function () {
	    changeHandler = setTimeout(function () {
		updateMarkers();
		changeHandler = null;
	    }, 100);
	});

	var updateMarkers = function () {
	    var annotations = [];
	    var newRange = {};
	    var cursor = selection.getCursor();
	    suppressions = [];

	    for (var i = 0; i<hints.length; i++) {
		var data = hints[i];
		var start_row = data.start_row;
		var start_col = data.start_col;
		var end_row = data.end_row;
		var end_col = data.end_col;
		if (data.suppressIfEditing &&
		    ((cursor.row === start_row && cursor.column == start_col+1)
		     || (cursor.row === end_row && (cursor.column+1) == end_col))) {
		    suppressions.push([start_row, start_col, end_row, end_col]);
		    continue;
		}

		//see if this error is inside a suppression
		var suppress = false;
		for (var j = 0; j < suppressions.length; j++) {
		    var e=suppressions[j];
		    var fromRow=e[0], fromCol=e[1], toRow=e[2], toCol=e[3];
		    if (start_row == fromRow && start_col >= fromCol && start_row === toRow  && start_col <= toCol) {
			suppress = true;
			break;
		    }
		}
		if(suppress) { continue; };

		var key = "(" + start_row + "," + start_col + ")" + ":" + "(" + end_row + "," + end_col + ")";
		newRange[key] = data;
		annotations.push(data);
	    }

	    var newKeys = Object.keys(newRange);
	    var oldKeys = Object.keys(savedRange);
	    var changes = 0;
	    for (i = 0; i < newKeys.length; i++) {
		key = newKeys[i];
		if (!savedRange[key]) {
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

	    for (i = 0; i < oldKeys.length; i++) {
		key = oldKeys[i];
		if (!newRange[key]) {
		    range = savedRange[key];
		    range.start.detach();
		    range.end.detach();
		    session.removeMarker(range.id);
		    delete savedRange[key];
		    changes++;
		}
	    }

	    if (changes>0) {
		session.setAnnotations(annotations);
	    };
	};

	worker.on("lint", function(results) {
	    hints = results.data;
	    if (hints.length > 100) {
		hints = hints.slice(0, 100); // limit to 100 errors
	    };
	    updateMarkers();
	});

	worker.on("terminate", function() {
	    // clear saved ranges
	    var oldKeys = Object.keys(savedRange);
	    for (var i = 0; i < oldKeys.length; i++) {
		var key = oldKeys[i];
		var range = savedRange[key];
		session.removeMarker(range.id);
		delete savedRange[key];
	    }

	});
	return worker;
    };
};
oop.inherits(Mode, TextMode);

(function() {
    this.type = "text";

    this.lineCommentStart = "%";

    this.$id = "ace/mode/latex";
}).call(Mode.prototype);

exports.Mode = Mode;

});
