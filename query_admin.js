const config = require('./src/config/index.js');
const visitors = require('./prism-sdk/src/server/engine/store/visitors.js');
const latest = visitors.getAllVisitors().pop();
console.log(JSON.stringify(latest, null, 2));
