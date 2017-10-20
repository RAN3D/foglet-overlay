module.exports = {
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: () => true,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['env']
          }
        }
      }
    ]
  }
};
