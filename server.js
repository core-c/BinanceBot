'use strict';
// dependencies: npm install express jquery binance-api-node

// app listen port
var port = process.env.PORT || 1337;

// express
var express = require('express');
var app = express();

// Binance
const Binance = require('binance-api-node').default;
var binance = Binance();


//===== LOCAL FUNCTIONS ================================================================================================

// Send a json string in this format: [[kline open time,kline close time,open,high,low,close,volume],...]
async function getTOHLCV(req, res) {
    // the symbol 
    if (req.query.symbol == undefined) return; // Promise.reject?
    if (req.query.interval == undefined) return; // Promise.reject?
    var qSymbol = req.query.symbol;
    var qInterval = req.query.interval;
    var binanceData = await binance.candles({ symbol: qSymbol, interval: qInterval }); // binance API call
    var jsonData = "[";
    for (var i = 0; i < binanceData.length; i++) {
        var obj = binanceData[i];
        jsonData += "[" + obj.openTime + ","+ obj.open + "," + obj.high + "," + obj.low + "," + obj.close + "," + obj.volume + "]";
        if (i != binanceData.length - 1) jsonData += ",";
    }
    jsonData += "]";
    res.send(jsonData).end();
}


async function getExchangeInfo(req, res) {
    var jsonExchangeInfo = await binance.exchangeInfo(); // binance API call
    res.send(jsonExchangeInfo).end();
}




//===== GET requests ===================================================================================================

// when accessing the root page, show the main webpage
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/webpage.html');
});

// the javascript files
app.get('/classChart.js', function (req, res) {
    res.sendFile(__dirname + '/classChart.js');
});
app.get('/classBinanceManager.js', function (req, res) {
    res.sendFile(__dirname + '/classBinanceManager.js');
});
app.get('/classBinanceSymbol.js', function (req, res) {
    res.sendFile(__dirname + '/classBinanceSymbol.js');
});
app.get('/math.js', function (req, res) {
    res.sendFile(__dirname + '/math.js');
});

// ajax: return the ohlc & volume data for a symbol, in json format.
// The symbol is defined in the request querystring (?symbol=)
// The symbol interval is defined in the request querystring (&interval=)
app.get('/getdata/tohlcv.json', function (req, res) {
    getTOHLCV(req, res);
});

// ajax: return the exchange info for Binance
app.get('/getdata/exchangeinfo.json', function (req, res) {
    getExchangeInfo(req, res);
});

//======================================================================================================================

// start listening on the specified port
app.listen(port);
