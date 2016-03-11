
var getCommentStart = function() {
  return (process.platform === 'win32') ? 'REM' : '#';
}

module.exports = {
  getCommentStart: getCommentStart
};