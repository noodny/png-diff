'use strict';

var fs = require('fs');
var PNG = require('pngjs2').PNG;
var Stream = require('stream');
var streamifier = require('streamifier');
var util = require('util');

function _getDimsMismatchErrMsg(dims1, dims2) {
  return util.format(
      'Images not the same dimension. First: %sx%s. Second: %sx%s.',
      dims1[0],
      dims1[1],
      dims2[0],
      dims2[1]
  );
}

function _turnPathOrStreamOrBufIntoStream(streamOrBufOrPath, done) {
  if (typeof streamOrBufOrPath === 'string') {
    streamOrBufOrPath = fs.createReadStream(streamOrBufOrPath).once('error', done);
  }

  if (streamOrBufOrPath instanceof Buffer) {
    streamOrBufOrPath = streamifier.createReadStream(streamOrBufOrPath).once('error', done);
  }

  if (!(streamOrBufOrPath instanceof Stream)) {
    return done(
        new Error('Argument needs to be a valid read path, stream or buffer.')
    );
  }

  done(null, streamOrBufOrPath);
}

function _turnPathsOrStreamsOrBufsIntoStreams(streamOrBufOrPath1, streamOrBufOrPath2, done) {
  _turnPathOrStreamOrBufIntoStream(streamOrBufOrPath1, function(err, res1) {
    if (err) return done(err);

    _turnPathOrStreamOrBufIntoStream(streamOrBufOrPath2, function(err, res2) {
      if (err) return done(err);

      done(null, res1, res2);
    });
  });
}

function desaturate(r, g, b) {
  var intensity = 0.3 * r + 0.59 * g + 0.11 * b;
  var k = 0.8;
  r = Math.floor(intensity * k + r * (1 - k));
  g = Math.floor(intensity * k + g * (1 - k));
  b = Math.floor(intensity * k + b * (1 - k));
  return [r, g, b];
}

function outputDiffStream(streamOrBufOrPath1, streamOrBufOrPath2, done) {
  _turnPathsOrStreamsOrBufsIntoStreams(streamOrBufOrPath1, streamOrBufOrPath2, function(err, stream1, stream2) {
    if (err) return done(err);

    // diff metric is either 0 or 1 for now. Might support outputting some diff
    // value in the future
    var diffMetric = 0;
    var writeStream = new PNG();
    stream1.pipe(writeStream).once('error', done).on('parsed', function() {
      var data1 = this.data;
      var dims1 = [this.width, this.height];
      stream2.pipe(new PNG()).once('error', done).on('parsed', function() {
        var data2 = this.data;
        var dims2 = [this.width, this.height];

        // swap places to use the longer file as a basis
        var tmp;
        if (data2.length > data1.length) {
          tmp = data1;
          data1 = data2;
          data2 = tmp;
        }

        var i = 0;
        var data = writeStream.data;
        // chunk of 4 values: r g b a
        while (data1[i] != null) {
          // var r, g, b, a;
          if (data1[i] !== data2[i] ||
              data1[i + 1] !== data2[i + 1] ||
              data1[i + 2] !== data2[i + 2] ||
              data1[i + 3] !== data2[i + 3]) {

            diffMetric += 4;
            // turn the diff pixels redder. No change to alpha
            var addRed = 60;

            if (data2[i] + addRed <= 255) {
              data[i] = data2[i] + addRed;
              data[i + 1] = Math.max(data2[i + 1] - addRed / 3, 0);
              data[i + 2] = Math.max(data2[i + 2] - addRed / 3, 0);
            } else {
              // too bright; subtract G and B instead
              data[i] = data2[i];
              data[i + 1] = Math.max(data2[i + 1] - addRed, 0);
              data[i + 2] = Math.max(data2[i + 2] - addRed, 0);
            }
          } else {
              var desaturated = desaturate(data1[i], data1[i + 1], data1[i + 2]);
              data[i] = desaturated[0];
              data[i + 1] = desaturated[1];
              data[i + 2] = desaturated[2];
          }
          i += 4;
        }

        return done(null, writeStream.pack(), Math.round((diffMetric/data1.length)*10000) / 100);
      });
    });

  });
}

function outputDiff(streamOrBufOrPath1, streamOrBufOrPath2, destPath, done) {
  outputDiffStream(streamOrBufOrPath1, streamOrBufOrPath2, function(err, res, diffMetric) {
    if (err) return done(err);

    res
        .pipe(fs.createWriteStream(destPath))
        .once('error', done)
        .on('close', done.bind(null, null, diffMetric));
  });
}

module.exports = {
  outputDiff: outputDiff,
  outputDiffStream: outputDiffStream
};
