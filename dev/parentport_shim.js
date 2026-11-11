// Для dev/test_nn_host.js: изображает process.parentPort Electron (сообщения приходят как { data }) поверх канала
// child_process.fork и запускает хост, переданный первым аргументом, — так проверяется ветка nn-host.js для utilityProcess.
'use strict';
const EventEmitter = require('events'), pp = new EventEmitter();
pp.postMessage = m => process.send(m);
process.on('message', m => pp.emit('message', { data: m }));
process.parentPort = pp;
require(process.argv[2]);
