"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var cheerio = require("cheerio");
// Load the saved HTML
var html = fs.readFileSync('/Users/emilngo/repos/projects/when-baddy/alpha-ajax-response.html', 'utf-8');
var $ = cheerio.load(html);
// Test 1: Can we find the lane table?
var laneTable = $('table.schemaLaneTable');
console.log('❓ Found schemaLaneTable:', laneTable.length > 0);
// Test 2: Can we extract court names?
var courtNames = [];
var laneRows = $('table.schemaLaneTable tbody tr');
console.log('❓ Total rows in schemaLaneTable:', laneRows.length);
laneRows.each(function (index, element) {
    var $row = $(element);
    var rowClass = ($row.attr('class') || '').toLowerCase();
    var courtName = $row.find('td.lineNumber span').text().trim();
    if (!rowClass.includes('hidden') && !rowClass.includes('times') && !rowClass.includes('prices')) {
        console.log("  Row ".concat(index, ": class=\"").concat($row.attr('class'), "\", courtName=\"").concat(courtName, "\""));
        if (courtName) {
            courtNames.push(courtName);
        }
    }
});
console.log("\u2705 Extracted ".concat(courtNames.length, " courts:"), courtNames);
// Test 3: Can we find the individual table?
var indTable = $('table.schemaIndividual');
console.log('❓ Found schemaIndividual:', indTable.length > 0);
// Test 4: Can we extract time slots?
var timeSlots = [];
var timeRow = $('table.schemaIndividual thead tr.times');
console.log('❓ Found times row:', timeRow.length > 0);
timeRow.find('td').each(function (index, element) {
    var time = $(element).text().trim();
    if (time) {
        timeSlots.push(time);
    }
});
console.log("\u2705 Extracted ".concat(timeSlots.length, " time slots:"), timeSlots);
// Test 5: Sample availability cells
var bodyRows = $('table.schemaIndividual tbody tr');
console.log('❓ Total body rows:', bodyRows.length);
// Check first real data row (skip special rows)
bodyRows.each(function (rowIdx, rowElement) {
    var $row = $(rowElement);
    var rowClass = ($row.attr('class') || '').toLowerCase();
    if (rowClass.includes('hidden') || rowClass.includes('times') || rowClass.includes('prices')) {
        return;
    }
    // This is a court row
    var cells = $row.find('td');
    console.log("\n\uD83D\uDCCD Court row ".concat(rowIdx, " (").concat($row.attr('class'), "): ").concat(cells.length, " cells"));
    // Show first 3 cells
    var availableCount = 0;
    cells.slice(0, 3).each(function (cellIdx, cellElement) {
        var $cell = $(cellElement);
        var cellClass = ($cell.attr('class') || '').toLowerCase();
        var hasLink = $cell.find('a').length > 0;
        var title = $cell.attr('title') || '';
        if (cellClass.includes('empty') || hasLink) {
            availableCount++;
            console.log("    Cell ".concat(cellIdx, ": AVAILABLE (class: \"").concat(cellClass, "\", has link: ").concat(hasLink, ")"));
        }
        else if (cellClass.includes('old')) {
            console.log("    Cell ".concat(cellIdx, ": PAST"));
        }
        else {
            console.log("    Cell ".concat(cellIdx, ": BOOKED (class: \"").concat(cellClass, "\")"));
        }
    });
    console.log("   Summary: ".concat(availableCount, " available in first 3 slots"));
    // Only show first court row for brevity
    if (rowIdx === 0) {
        console.log('   (showing only first court row for brevity)');
    }
    return false; // Break after first non-special row
});
