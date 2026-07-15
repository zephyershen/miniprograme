import type { UserConfigExport } from "@tarojs/cli";

export default {
  mini: {},
  h5: {
    compile: {
      include: [
        (filename) =>
          /node_modules\/(?!(@babel|core-js|style-loader|css-loader|react|react-dom))/.test(filename),
      ],
    },
  },
} satisfies UserConfigExport<"webpack5">;
