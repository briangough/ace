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

if (typeof process !== "undefined") {
    require("amd-loader");
}

define(function(require, exports, module) {
"use strict";

var assert = require("../test/assertions");
var LatexWorker = require("./latex_worker").LatexWorker;


module.exports = {
    setUp : function() {
        this.sender = {
            on: function() {},
            callback: function(data, id) {
                this.data = data;
            },
            events: [],
            emit: function(type, e) {
                this.events.push([type, e]);
            }
        };
    },

    "test check for simple environment match without errors": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\begin{foo}\n" +
                        "\\end{foo}\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },

    "test invalid \\it* command": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\it*hello\n" + "\\bye\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },

    "test newcomlumntype": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("hello\n" + 
                        "\\newcolumntype{M}[1]{>{\\begin{varwidth}[t]{#1}}l<{\\end{varwidth}}}\n" +
                        "bye");
        worker.deferredUpdate.call();
        
        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },
    
    "test newenvironment": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("\\newenvironment{Algorithm}[2][tbh]%\n" +
                        "{\\begin{myalgo}[#1]\n" +
                        "\\centering\n" +
                        "\\part{title}\\begin{minipage}{#2}\n" +
                        "\\begin{algorithm}[H]}%\n" +
                        "{\\end{algorithm}\n" +
                        "\\end{minipage}\n" +
                        "\\end{myalgo}}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },

    // "test newenvironment II": function() {
    //     var worker = new LatexWorker(this.sender);
    //     worker.setValue("\\newenvironment{claimproof}[1][\\myproofname]{\\begin{proof}[#1]\\renewcommand*{\\qedsymbol}{\\(\\diamondsuit\\)}}{\\end{proof}}");
    //     worker.deferredUpdate.call();

    //     var errors = this.sender.events[0][1];
    //     assert.equal(errors.length, 0);
    // },

    "test superscript inside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is $a^b$ test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },

    "test subscript inside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is $a_b$ test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },

    "test superscript outside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is a^b test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 1);
        assert.equal(errors[0].text, "^ must be inside math mode");
        assert.equal(errors[0].type, "error");
    },

    "test subscript outside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is a_b test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 1);
        assert.equal(errors[0].text, "_ must be inside math mode");
        assert.equal(errors[0].type, "error");
    },

    "test math mode inside \\hbox outside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is \\hbox{for every $bar$}");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },

   
    "test math mode inside \\hbox inside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is $foo = \\hbox{for every $bar$}$ test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },

    "test math mode inside \\text inside math mode": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is $foo = \\text{for every $bar$}$ test");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    },

    "test verbatim": function() {
        var worker = new LatexWorker(this.sender);
        worker.setValue("this is text\n" +
                        "\\begin{verbatim}\n" +
                        "this is verbatim\n" +
                        "\\end{verbatim}\n" +
                        "this is more text\n");
        worker.deferredUpdate.call();

        var errors = this.sender.events[0][1];
        assert.equal(errors.length, 0);
    }


    
};

});

if (typeof module !== "undefined" && module === require.main) {
    require("asyncjs").test.testcase(module.exports).exec();
}
