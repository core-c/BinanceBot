

function isNothing(obj) {
    return (obj == null || obj == undefined);
}

function isArray(obj) {
    return (!isNothing(obj) && Array.isArray(obj) && obj.length > 0);
}

function isValue(obj) {
    return (!isNothing(obj) && !isNothing(obj.value));
}


// inArray is of the format:
//      [obj, ...]
//      where the obj can be undefined (or null).
//      otherwise obj is of the format: { time: number, value: number}
// The result of this function is a number. The average of all values.
function arrayAvg_Tvalue(inArray, fromIndex = undefined, toIndex = undefined) {
    if (!isArray(inArray)) return undefined;
    {
        let sum = 0;
        let count = 0;
        let fromI = 0;
        let toI = inArray.length - 1;
        if (fromIndex != undefined) fromI = Math.min(Math.max(fromIndex, 0), inArray.length - 1);
        if (toIndex != undefined) toI = Math.min(Math.max(toIndex, 0), inArray.length - 1);
        if (toI < fromI) return undefined; // from-to woot..
        for (var i = fromI; i <= toI; i++) {
            if (!isValue(inArray[i])) continue;
            count++;
            sum += inArray[i].value;
        }
        return (count == 0) ? undefined : (sum / count);
    }
}

// theTimes is of the format: [time,...]                        (series.xData)
// theData is of the format: [[open, high, low, close],...]     (series.yData of candles)
// This function returns 'undefined' on any error,
// on success, it returns an array of objects (of the same size as the input array theData):
//      [obj, ...]
//      where the obj can be undefined.
//      otherwise obj is of the format: { time: number, value: number}
// We want to keep the original timestamps along with the calculated values..
function roc_TOHLC(theTimes, theData, period) {
    let outData = [];
    if (!isArray(theTimes) || !isArray(theData)) return undefined;
    const L = theData.length;
    if (L < period) return undefined;
    for (var i = 0; i < L; i++) {
        var result = undefined;
        if (i >= period) {
            if (isArray(theData[i - period]) && isArray(theData[i])) {
                const valueIp = theData[i - period][3]; // close price
                const valueI = theData[i][3];
                if (!isNothing(valueIp) && !isNothing(valueI)) {
                    result = (valueIp == 0) ? undefined : (valueI - valueIp) / valueIp;
                }
            }
        }
        outData[i] = {
            time: theTimes[i],
            value: result
        };
    }
    return outData;
}

// Simple Moving Average
// theData is of the format:
//      [obj, ...]
//      where the obj can be undefined.
//      otherwise obj is of the format: { time: number, value: number}
// The result of this function is of the format:
//      [obj, ...]
//      where the obj can be undefined.
//      otherwise obj is of the format: { time: number, value: number}
function sma_Tvalue(theTimes, theData, period) {
    let outData = [];
    if (!isArray(theTimes) || !isArray(theData)) return undefined;
    for (var i = 0; i < theData.length; i++) {
        outData[i] = {
            time: theTimes[i],
            value: arrayAvg_Tvalue(theData, i - period, i)
        };
    }
    return outData;
}

// Know Sure Thing
// references:
//   https://school.stockcharts.com/doku.php?id=technical_indicators:know_sure_thing_kst
//
// theData is an array of 
// We return an array of objects:
//      [{time:number, kst:number, signal:number, isCrossover:boolean, isCrossunder:boolean, isRendered:boolean}, ...]
function kst(theTimes, theData, rocPeriod1, rocPeriod2, rocPeriod3, rocPeriod4, smaPeriod1, smaPeriod2, smaPeriod3, smaPeriod4, smaKstPeriod) {
    let result = [];
    let rocdata1, rocdata2, rocdata3, rocdata4,
        smadata1, smadata2, smadata3, smadata4,
        kstdata, smakst, crossoverdata, crossunderdata;

    if (!isArray(theTimes) || !isArray(theData)) return undefined;

    rocdata1 = roc_TOHLC(theTimes, theData, rocPeriod1);
    rocdata2 = roc_TOHLC(theTimes, theData, rocPeriod2);
    rocdata3 = roc_TOHLC(theTimes, theData, rocPeriod3);
    rocdata4 = roc_TOHLC(theTimes, theData, rocPeriod4);

    smadata1 = sma_Tvalue(theTimes, rocdata1, smaPeriod1);
    smadata2 = sma_Tvalue(theTimes, rocdata2, smaPeriod2);
    smadata3 = sma_Tvalue(theTimes, rocdata3, smaPeriod3);
    smadata4 = sma_Tvalue(theTimes, rocdata4, smaPeriod4);

    // the Know Sure Thing values
    kstdata = [];
    if (!isNothing(smadata1) && !isNothing(smadata2) && !isNothing(smadata3) && !isNothing(smadata4)) {
        for (var i = 0; i < theData.length; i++) {
            if (!isValue(smadata1[i]) || !isValue(smadata2[i]) || !isValue(smadata3[i]) || !isValue(smadata4[i])) {
                kstdata[i] = undefined; // not even visible in the chart
            } else {
                kstdata[i] = {
                    time: theTimes[i],
                    value: smadata1[i].value + (2 * smadata2[i].value) + (3 * smadata3[i].value) + (4 * smadata4[i].value)
                };
            }
        }
    }

    // the signal line
    smakst = sma_Tvalue(theTimes, kstdata, smaKstPeriod);

    // crossover & crossunder
    crossoverdata = [false]; // with a first default element[0]..
    crossunderdata = [false];
    for (var i = 1; i < theData.length; i++) { // start at index 1
        if (!isValue(kstdata[i - 1]) || !isValue(kstdata[i]) || !isValue(smakst[i - 1]) || !isValue(smakst[i])) {
            crossoverdata[i] = false;
            crossunderdata[i] = false;
        } else {
            crossoverdata[i] = (kstdata[i - 1].value <= smakst[i - 1].value && kstdata[i].value > smakst[i].value);
            crossunderdata[i] = (kstdata[i - 1].value >= smakst[i - 1].value && kstdata[i].value < smakst[i].value);
        }
    }

    // all final values of the result
    for (var i = 0; i < theData.length; i++) {
        result[i] = {
            time: theTimes[i], 
            kst: (!isValue(kstdata[i])) ? undefined : kstdata[i].value,
            signal: (!isValue(smakst[i])) ? undefined : smakst[i].value,
            isCrossover: (isNothing(crossoverdata[i])) ? undefined : crossoverdata[i],
            isCrossunder: (isNothing(crossunderdata[i])) ? undefined : crossunderdata[i]
        };
    }

    return result;
}
