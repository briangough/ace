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
	var worker = new WorkerClient(["ace"], "ace/mode/latex_worker", "LatexWorker");
	var savedRange = {};

	worker.attachToDocument(session.getDocument());

	worker.on("lint", function(results) {
   	    // addDynamicMarker(Object marker, Boolean inFront)
	    // addGutterDecoration(Number row, String className)
	    // addMarker(Range range, String clazz, Function | String type, Boolean inFront)
	    // removeGutterDecoration(Number row, String className)
	    // removeMarker(Number markerId)
	    var newRange = {};
	    for (var i = 0; i<results.data.length; i++) {
		var start_row = results.data[i].start_row;
		var end_row = results.data[i].end_row;
		var key = start_row + ":" + end_row;
		newRange[key] = results.data[i];
	    }

	    var newKeys = Object.keys(newRange);
	    var oldKeys = Object.keys(savedRange);
	    
	    for (i = 0; i < newKeys.length; i++) {
		key = newKeys[i];
		if (!savedRange[key]) {
		    var new_range = newRange[key];
		    var range = new Range(new_range.start_row, 0, new_range.end_row, Infinity);
		    range.id = session.addMarker(range, "ace_error-marker", "fullLine");
		    savedRange[key] = range;
		}
	    }

	    for (i = 0; i < oldKeys.length; i++) {
		key = oldKeys[i];
		if (!newRange[key]) {
		    range = savedRange[key];
		    session.removeMarker(range.id);
		    delete savedRange[key];
		}
	    }
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
