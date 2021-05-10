

const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
const WSTIMEOUTSMS = { open: 7000, msg: 60000 }; // watchdog timeout values (in milliseconds).
const WSACTIVITYBLEEP = 300;    // in milliseconds. How long the bleep is visible on the webpage right-corner
                                // ! keep in sync with css #activityarea transition duration !


// Manage all symbols/ajax/streams.
// todo: this class should get the latest exchangeinfo periodically: every day/week/...
//       Binance says: a stream is closed after 24h.   But the exchangeinfo call is not done via a stream..
class BinanceManager {
    // the constructor arguments are the Id of the respective webpage elements:
    //   symbolsElementId:		the 'select' for the symbols
    //   intervalsElementId:	the 'select' for the intervals
    //   messageElementId:		the messages area
    //   activityElementId:		the activity area
    //   inspectListId:         the Id of the table-element (list of symbol-streams to inspect)
    //   chartContainerId:		the highchart/stockchart container Id
    constructor(symbolsElementId, intervalsElementId, messageElementId, activityElementId, inspectListId, chartContainerId) {
        // webpage document elements
        this.elements = {
            symbols: $('#' + symbolsElementId),
            intervals: $('#' + intervalsElementId),
            messages: $('#' + messageElementId),
            activity: $('#' + activityElementId),
            inspectlist: $('#' + inspectListId),
            chart: new ChartClass(this, chartContainerId)
        }

        // current values of the webpage dropdown/select
        this.current = {
            symbol: undefined,		// string
            interval: undefined		// string
        }

        // array of all the streams:
        // this is an array of objects:
        //   [{ 
        //      symbol: string,
        //      interval: string,
        //      signal: boolean,            // true, if this stream is used to detect signals
        //      ref: instance,
        //      ativityTimer: timeoutId
        //    },...]
        this.streams = [];

        // the index of the stream used in the chart
        this.chartStreamIndex = -1;

        // fire up..
        this.init();
    }

    // find the stream: If found, return the index..  else return -1
    streamFind(theSymbol, theInterval) {
        for (var i = 0; i < this.streams.length; i++) {
            var s = this.streams[i];
            if (s.symbol != theSymbol || s.interval != theInterval) continue;
            return i;
        }
        return -1;
    }

    // close any stream that is not used for signalling (there should always be max. 1)
    async streamCloseNonSignal() {
        for (var i = 0; i < this.streams.length; i++) {
            var s = this.streams[i];
            if (s.signal) continue;             // skip signal streams
            await s.ref.destroyWebSocket();     // close the websocket
            s.ref = undefined;                  // destroy the class instance
            this.streams.splice(i, 1);          // remove the entry from the streams array
        }
    }
    // close all streams
    async streamCloseAll() {
        for (var i = 0; i < this.streams.length; i++) {
            var s = this.streams[i];
            await s.ref.destroyWebSocket();     // close the websocket
            s.ref = undefined;                  // destroy the class instance
            this.streams.splice(i, 1);          // remove the entry from the streams array
        }
    }

    // create a new stream. Return the new stream's index
    streamOpen(theSymbol, theInterval) {
        var newstream = {
            symbol: theSymbol,
            interval: theInterval,
            signal: false,
            ref: new BinanceSymbol(theSymbol, theInterval, this, true),
            activityTimer: undefined
        };
        this.streams.push(newstream);
        return (this.streams.length - 1);
    }

    async setChartStream(theSymbol, theInterval) {
        try {
            // test if this stream is already open
            for (var i = 0; i < this.streams.length; i++) {
                var s = this.streams[i];
                if (s.symbol != theSymbol || s.interval != theInterval) continue;
                // set the chart to the found stream
                this.chartStreamIndex = i;
                // if this is the (only) non-signal stream then we're done
                if (!s.signal) return true; // goto finally..
                // close any stream that is not used for signalling (there should always be max. 1)
                await this.streamCloseNonSignal();
                return true; // goto finally..
            }
            // the chart stream is not yet open. Add a new stream..
            this.chartStreamIndex = this.streamOpen(theSymbol, theInterval);
            return true;
        } finally {
            // display the stream in the chart
            this.elements.chart.assignStream(theSymbol, theInterval);
        }
    }

    setChartStreamData(theSymbol, theInterval) {
        if (this.elements.chart == undefined) return; // no webpage element
        if (this.chartStreamIndex == -1) return; // chart not assigned to any stream
        {
            var i = this.streamFind(theSymbol, theInterval);
            if (i != this.chartStreamIndex) return;
            {
                var s = this.streams[i];
                var data = s.ref.data;
                this.elements.chart.setData(data);
            }
        }
    }

    async init() {
        await this.getExchangeInfo(); // and fill the symbols- & intervals-dropdowns
        this.loadUserSettings(); // load the user configuration
        // open the default symbol/interval stream in the chart
        await this.setChartStream(this.current.symbol, this.current.interval);
    }

    async destroy() {
        this.saveUserSettings(); // save the user configuration
        await this.streamCloseAll();
        this.chartStreamIndex = -1; // invalidate
    }

    // theSymbol is a string
    async setCurrentSymbol(theSymbol) {
        this.current.symbol = theSymbol;
        await this.setChartStream(this.current.symbol, this.current.interval);  // update the chart..
    }

    // theInterval is a string
    async setCurrentInterval(theInterval) {
        this.current.interval = theInterval;
        await this.setChartStream(this.current.symbol, this.current.interval);  // update the chart..
    }

    async setCurrentSymbolInterval(theSymbol, theInterval) {
        this.elements.symbols.val(theSymbol);
        this.elements.intervals.val(theInterval);
        this.current.symbol = theSymbol;
        this.current.interval = theInterval;
        await this.setChartStream(this.current.symbol, this.current.interval);  // update the chart..
    }

    streamGetChartFlagSignal() {
        if (this.elements.chart == undefined) return false; // no webpage element
        if (this.chartStreamIndex == -1) return false;
        if (this.chartStreamIndex >= this.streams.length) return false;
        return this.streams[this.chartStreamIndex].signal;
    }

    // set the chart stream signal-flag
    // "signalled" symbols will be used in generating signals.
    // The streams of those "signalled" symbols will be kept alive, and the data will be stored for analysis.
    streamSetChartFlagSignal() {
        if (!this.streamGetChartFlagSignal()) {
            var s = this.streams[this.chartStreamIndex];
            s.signal = true;
            // add a row to the webpage table
            this.streamAddTableRow(s.symbol, s.interval);
        }
    }

    // clear the stream signal-flag
    // No longer keep this stream alive. Also remove the table-row of this stream on the webpage..
    // argument 'theRow' is a number. It's the index of the webpage table row.
    streamClearFlagSignal(theSymbol, theInterval, theRow) {
        var i = this.streamFind(theSymbol, theInterval);
        if (i == -1) return;
        this.streams[i].signal = false;
        this.streamRemoveTableRow(theRow);
    }

    // print a message in the message area on the webpage
    printMessage(theClassBinanceSymbol, color = '#FFFFFF', text = '') {
        this.elements.messages.css('background', color).text(text);
    }

    // show activity indicators
    connActivity(theClassBinanceSymbol, state = false, color = '#FFFFFF') {
        var _this = this;
        var streamIndex = this.streamFind(theClassBinanceSymbol.symbol, theClassBinanceSymbol.interval);
        if (streamIndex == -1) return;
        var turnOff = false;
        // is the symbol displayed in the chart?
        if (streamIndex == this.chartStreamIndex) {
            if (state) this.elements.activity.css('background', color); // update the activityarea
            this.elements.activity.attr("activity", state); // start/stop the opacity transition
            turnOff = true;
        }
        // draw an activity-indicator in the table row for this stream
        var table = inspectlist; // ? why not this.elements.inspectlist
        var nrows = table.rows.length;
        for (var r = 0; r < nrows; r++) {
            var row = table.rows[r];
            var theSymbol = row.cells[0].innerHTML;
            var theInterval = row.cells[1].innerHTML;
            if (theClassBinanceSymbol.symbol == theSymbol && theClassBinanceSymbol.interval == theInterval) {
                // we found the row..
                var cell = row.cells[2];
                var span = cell.getElementsByTagName("span")[0]; // streamactivity
                //var span = $(cell).find("streamactivity");
                if (state) $(span).css('background', color); // update the streamactivity span
                $(span).attr("activity", state); // start/stop the opacity transition
                turnOff = true;
                break; // the for loop
            }
        }
        if (turnOff) {
            // clear the timer
            var s = this.streams[streamIndex];
            if (s.activityTimer != undefined) {
                clearTimeout(s.activityTimer);
                s.activityTimer = undefined;
            }
            // and set a new timer, if needed (to turn off the indication)
            if (state) s.activityTimer = setTimeout(function () { _this.connActivity(theClassBinanceSymbol) }, WSACTIVITYBLEEP);
        }
    }

    getExchangeInfo() {
        var _this = this; // this class instance
        return new Promise((resolve, reject) => {
            try {
                // fill the dropdownbox with symbol intervals.
                // The intervals are always the same => static/constant values.
                _this.elements.intervals.empty();
                $.each(INTERVALS, function (i, val) {
                    _this.elements.intervals.append($('<option>').val(val).text(val))
                });
                // set the first value as the currently selected interval
                _this.current.interval = INTERVALS[0];

                // do an ajax request for the Binance exchange info, at our NodeJS server
                $.get('/getdata/exchangeinfo.json', function (theData, status) {
                    if (status != 'success') {
                        _this.current.symbol = undefined;
                        throw 'ajax retrieving exchangeinfo';
                    }
                    // ..for now, we're only interested in the supported symbols
                    _this.elements.symbols.empty(); // clear the select/dropdown element
                    if (theData.symbols.length > 0) {
                        // fill the dropdownbox with all symbols.
                        // sort on quoteAsset & baseAsset alphabetically
                        theData.symbols.sort(function (a, b) {
                            if (a.quoteAsset < b.quoteAsset) return -1;
                            if (a.quoteAsset > b.quoteAsset) return 1;
                            // quoteAssets are equal, so sort on baseAsset too
                            if (a.baseAsset < b.baseAsset) return -1;
                            if (a.baseAsset > b.baseAsset) return 1;
                            return 0;
                        });

                        $.each(theData.symbols, function (i, val) {
                            // skip all symbols that are not ready for trading..
                            if (val.status == "TRADING") {
                                _this.elements.symbols.append($('<option>').val(val.symbol).text(val.symbol))
                            }
                        });
                        // set the first value as the currently selected symbol
                        _this.current.symbol = theData.symbols[0].symbol;
                        //
                        resolve(true); // this promise was successful: end it
                    } else {
                        // there is not a single symbol returned
                        _this.current.symbol = undefined;
                        throw 'no symbol in exchangeinfo';
                    }
                });
            } catch (err) {
                alert(err);
                reject(false); // this promise failed: end it
            }
        })
    }

    // Update the chart with the fresh stream candle data.
    // Called by the WebSocket onmessage handler when new stream data is received.
    // Stream data payload: https://binance-docs.github.io/apidocs/futures/en/#kline-candlestick-streams
/*
    {
        "e": "kline",       // Event type
        "E": 123456789,     // Event time
        "s": "BTCUSDT",     // Symbol
        "k": {
            "t": 123400000, // Kline start time
            "T": 123460000, // Kline close time
            "s": "BTCUSDT", // Symbol
            "i": "1m",      // Interval
            "f": 100,       // First trade ID
            "L": 200,       // Last trade ID
            "o": "0.0010",  // Open price
            "c": "0.0020",  // Close price
            "h": "0.0025",  // High price
            "l": "0.0015",  // Low price
            "v": "1000",    // Base asset volume
            "n": 100,       // Number of trades
            "x": false,     // Is this kline closed?
            "q": "1.0000",  // Quote asset volume
            "V": "500",     // Taker buy base asset volume
            "Q": "0.500",   // Taker buy quote asset volume
            "B": "123456"   // Ignore
        }
    }
*/
    chartAddCandle(candle) {
        if (this.elements.chart == undefined) return false;
        if (this.chartStreamIndex == -1) return false;
        if (this.chartStreamIndex >= this.streams.length) return false;
        {
            var s = this.streams[this.chartStreamIndex];
            // is this candle valid for the chart displayed stream?
            if (candle.s != s.symbol) return false;
            if (candle.k.i != s.interval) return false;
            // add this candle to the chart
            this.elements.chart.addCandle(candle);
            return true;
        }
    }

    // add a new row for this stream in the webpage table
    streamAddTableRow(theSymbol, theInterval) {
        var _this = this;
        // add a new row to the array
        var row = inspectlist.insertRow(-1); // last row
        row.setAttribute("id", "trinspect"); // apply the css style
        var cell0 = row.insertCell(-1); // last cell
        var cell1 = row.insertCell(-1);
        var cell2 = row.insertCell(-1);
        var cell3 = row.insertCell(-1);
        //cell0.innerHTML = $('#inspectlist tr').length - 2; // table row number (th is also a row)
        cell0.innerHTML = theSymbol;
        cell0.id = 'inspectSymbol';
        cell1.innerHTML = theInterval;
        cell1.id = 'inspectInterval';

//        cell2.innerHTML = '<span id="streamactivity">&nbsp</span>'; // the css style is not applied !
        var obj = document.createElement("span");
        obj.setAttribute("id", "streamactivity");
        var t = document.createTextNode("\u00A0"); // where's the css width:10px ? => add a space
        obj.appendChild(t);
        cell2.appendChild(obj);

        cell2.id = 'inspectSignals';
        cell3.innerHTML = ''; // the remove dropzone
        cell3.id = 'inspectRemove';
        cell3.draggable = true;
        cell3.addEventListener("dragstart", dragStartHandler);
        // add an ondblclick event handler for the row
        row.addEventListener("dblclick", function (event) { _this.setCurrentSymbolInterval(theSymbol, theInterval); });
    }

    // remove the row for this stream from the webpage table
    streamRemoveTableRow(theRow) {
        inspectlist.deleteRow(theRow);
    }

    // use the localStorage to save the user config
    saveUserSettings() {
        // the current settings for the dropdowns: symbols & intervals
        localStorage.setItem("bbCurrentSymbol", this.current.symbol);
        localStorage.setItem("bbCurrentInterval", this.current.interval);
        // the streams in the inspect list
        var streamslist = [];
        for (var i = 0; i < this.streams.length; i++) {
            if (!this.streams[i].signal) continue;
            var s = { s: this.streams[i].symbol, i: this.streams[i].interval };
            streamslist.push(s);
        }
        localStorage.setItem("bbStreamList", JSON.stringify(streamslist));
    }

    loadUserSettings() {
        // the streams
        var symbol = "";
        var interval = "";
        var str = localStorage.getItem("bbStreamList");
        if (str && str != "") {
            var streamslist = JSON.parse(str);
            for (var i = 0; i < streamslist.length; i++) {
                symbol = streamslist[i].s;
                interval = streamslist[i].i;
                var idx = this.streamFind(symbol, interval);
                if (idx == -1) idx = this.streamOpen(symbol, interval); // not found in the list, open the stream
                // set the signal flag
                this.streams[idx].signal = true;
                // add a row to the webpage table
                this.streamAddTableRow(symbol, interval);
            }
        }
        // the dropdowns: symbol & interval
        symbol = localStorage.getItem("bbCurrentSymbol");
        interval = localStorage.getItem("bbCurrentInterval");
        if (symbol && interval && symbol != "" && interval != "") {
            this.setCurrentSymbolInterval(symbol, interval);
        }
    }
}
