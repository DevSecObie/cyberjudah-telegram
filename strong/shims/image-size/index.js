// Metro calls image-size 1.x as sizeOf(bufferOrPath). 2.x takes only bytes, so a path is read first.
const { readFileSync } = require("node:fs");
const v2 = require("image-size-v2");
const imageSize = (input) => v2.imageSize(typeof input === "string" ? readFileSync(input) : input);
module.exports = imageSize;
module.exports.default = imageSize;
module.exports.imageSize = imageSize;
module.exports.types = v2.types;
