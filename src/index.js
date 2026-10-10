'use strict';

/** 夜织 CialloForge · 程序化入口 */

const datastore = require('./engine/datastore');
const promptEngine = require('./engine/prompt');
const storyEngine = require('./engine/story');
const validate = require('./engine/validate');
const tokens = require('./engine/tokens');
const voice = require('./engine/voice');
const { Rng } = require('./util/rng');
const text = require('./util/text');
const io = require('./util/io');

module.exports = {
  datastore,
  prompt: promptEngine,
  story: storyEngine,
  validate,
  tokens,
  voice,
  Rng,
  text,
  io,
  version: require('../package.json').version,
};
