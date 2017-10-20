module.exports = {
  test: /\.js$/,
  exclude: () => true,
  use: {
    loader: 'babel-loader',
    options: {
      presets: ['env']
    }
  }
}
