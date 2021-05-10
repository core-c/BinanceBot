
// Manage one Binance symbol:
// Load historical data, receive new data by stream, keep up the stream.
// Update the webpage via the BinanceManager.
class BinanceSymbol {
    // our constructor method
    constructor(symbol, interval, theClassBinanceManager, startActive = false) {
        this.symbol = symbol;
        this.interval = interval;
        this.mgr = theClassBinanceManager;
        //=== private variables:
        this.ws = undefined;			// WebSocket object
        this.wsTimestamp = {			// Watchdog timestamps (when what occured):
            instance: 0,				//		WebSocket creation
            open: 0,					//		'open'-event
            close: 0,					//		'close'-event
            error: 0,					//		'error'-event
            msg: 0						//		'message'-event
        }
        // the data: timestamp + OHLC + volume
        this.data = [];

        // event handlers
        this.handlerError = () => {
            this.wsTimestamp.error = Date.now();	// save a timestamp for the watchdog
            this.mgr.connActivity(this, true, '#D12424');	// red visual indication
        }
        this.handlerClose = () => {
            this.wsTimestamp.close = Date.now();	// save a timestamp for the watchdog
            this.mgr.connActivity(this, true, '#D12424');	// red visual indication
        }
        this.handlerOpen = () => {
            this.wsTimestamp.open = Date.now();	// save a timestamp for the watchdog
            this.mgr.connActivity(this, true, '#F59B42');	// orange visual indication
        }
        this.handlerMessage = (event) => {
            this.wsTimestamp.msg = Date.now();		// save a timestamp for the watchdog
            // store the new data..
            var candle = JSON.parse(event.data);
            this.storeCandle(candle);				// store new data class-locally
            // webpage updates
            this.mgr.connActivity(this, true, '#00A000');	// green visual indication
            this.mgr.chartAddCandle(candle);		// display in chart (possibly)
            // help the javascript garbage collector.
            // If we don't destroy this candle, it appears to never get de-allocated
            // (at least, not in chrome).
            // With some streams open, this app would eat memory like crazy.
            // If no more memory can be allocated, you'll get an error: SBOX_MEMORY_EXCEEDED
            candle = null;
        }

        // start async downloading the data in a moment.. We can not have an async constructor.
//                    setTimeout(this.init(), 100);
        if (startActive) this.init();   // start retrieving data, or not..
    }

    //=== private functions:
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    storeCandle(candle) {
        if (!candle.k.x) return; // the candle must be closed
        var dataTOHLCV = [candle.k.t, +candle.k.o, +candle.k.h, +candle.k.l, +candle.k.c, +candle.k.v]; // the + will convert it to a number..
        this.data.push(dataTOHLCV);
    }

    // Websocket:
    // Create a new WebSocket instance
    initWebSocket() {
        try {
            var url = "wss://stream.binance.com/ws/" + this.symbol.toLowerCase() + "@kline_" + this.interval;
            this.ws = new WebSocket(url);
            this.ws.addEventListener('error', this.handlerError);
            this.ws.addEventListener('open', this.handlerOpen);
            this.ws.addEventListener('close', this.handlerClose);
            this.ws.addEventListener('message', this.handlerMessage);
        } catch (err) {
            // SECURITY_ERR     The port to which the connection is being attempted is being blocked.
            // SyntaxError      The URL is invalid.
            //alert("initWebSocket(): " + err);
            this.ws = undefined;
        }
        return this.ws;
    }

    // Invalidate an existing WebSocket instance: destroy it
    async destroyWebSocket() {
        try {
            // if a WebSocket already exists, then invalidate it and destroy the instance
            if (this.ws != undefined) {
                try {
                    // first, remove event handlers (we don't want any watchdog errors while we close the socket)
                    $(this.ws).off(); // JQuery is king, removeEventListener() is woot.
                    // then, close the WebSocket connection
                    await this.ws.close(1000); // 1000 = normal closure (to prevent INVALID_ACCESS_ERR)
                    //while (this.ws.readyState != 3) await this.sleep(100); // wait for closed status
                } catch (err) {
                    // INVALID_ACCESS_ERR: An invalid code was specified.
                    // SYNTAX_ERR: The reason string is too long or contains unpaired surrogates.
                }
            }
        } finally {
            // reset all timestamps for the watchdog
            this.wsTimestamp = { instance: 0, open: 0, close: 0, error: 0, msg: 0 };
            // explicitely destroy the WebSocket instance
            this.ws = undefined;
        }
        return this.ws;
    }

    async setupStream() {
        // dispose of any existing WebSocket instance
        await this.destroyWebSocket();
        // create a new WebSocket instance. On fail, try again in one second
        while (await this.initWebSocket() == undefined) await this.sleep(1000);
        // the WebSocket instance exists, but the readyState is not yet opened
        this.wsTimestamp.instance = Date.now(); // save a timestamp for the watchdog
        return this;
    }

    // watchdog to keep alive the WebSocket stream connection
    watchDog() {
        var _this = this;
        try {
            // a websocket must exists
            if (!this.wsTimestamp.instance) return; // no ws? goto finally..
            // test for an unexpected 'error' event (initiated by the endpoint)
            if (this.wsTimestamp.error) throw 'connection error'; // goto catch
            // test for an unexpected 'close' event (initiated by the endpoint)
            if (this.wsTimestamp.close) throw 'closed by endpoint'; // goto catch
            // test for an 'open' timeout
            if (this.wsTimestamp.open - this.wsTimestamp.instance > WSTIMEOUTSMS.open) throw 'open error';
            if (!this.wsTimestamp.open) return; // not opened yet? goto finally..
            // test for a 'message' timeout:
            if (!this.wsTimestamp.msg) return; // no msg received yet? goto finally..
            //if (Date.now() - wsTimestamp.msg > WSTIMEOUTSMS.msg) throw 'no message flow'; // goto catch
            if (Date.now() - this.wsTimestamp.msg > WSTIMEOUTSMS.msg) {
                // make this a warning
                this.mgr.printMessage(this, '#DDFFDD', 'Stream: no message flow');
            } else {
                // if code execution gets it to here, no errors had occured..
                this.mgr.printMessage(this, '#FFFFFF', '');
            }
            // goto finally..
        } catch (err) {
            this.mgr.printMessage(this, '#FFDDDD', 'Stream: ' + err);
            // on error, re-instantiate the websocket
            setTimeout(function () { _this.setupStream() }, 100);
            // goto finally..
        } finally {
            // Code execution will always get here.. finally.
            // Always keep testing the connection, again in one second
            setTimeout(function () { _this.watchDog() }, 1000);
        }
    }


    // * get historical data:
    // ajax request data, and store it in the class this.#data
    // The data is of the format: [[time,open,high,low,close,volume]...]
    async ajaxGetHistoricalData() {
        var _this = this; // this class instance
        return new Promise((resolve, reject) => {
            try {
                var queryStr = "?symbol=" + _this.symbol;
                queryStr += '&interval=' + _this.interval;
                const url = '/getdata/tohlcv.json' + queryStr;
                // do a request for the timestamp & OHLC & volume json data, at the NodeJS server app
                $.get(url, function (theData) {
                    // copy as array/object, not as json
                    _this.data = JSON.parse(theData);
                    // possibly display the data in the chart
                    _this.mgr.setChartStreamData(_this.symbol, _this.interval);
                    //
                    resolve(true);
                })
            } catch (err) {
                reject(false);
            }
        })
    }

    // asynchronous method to retrieve all the needed data
    async init() {
        this.watchDog(); // start the watchdog to test for any warnings/errors
        await this.ajaxGetHistoricalData(); // data from the Binance-API NodeJS server
        await this.setupStream(); // streaming data from the client WebSocket
    }
}
