# Study English

英语学习小程序，当前技术栈为 `Taro + React + Tailwind CSS`，运行目标是微信小程序。

## 项目路径

- Windows: `D:\\miniprogram\\study-english`
- WSL: `/mnt/d/miniprogram/study-english`

## 启动方式

### 1. 安装依赖

第一次启动，或依赖丢失时执行：

```bash
cd /mnt/d/miniprogram/study-english
npm install
```

如果安装时遇到 Taro 的 peer dependency 报错，再执行：

```bash
npm install --legacy-peer-deps
```

### 2. 启动微信小程序开发监听

```bash
cd /mnt/d/miniprogram/study-english
npm run dev:weapp
```

这条命令会持续监听源码改动，并自动重新编译到 `dist/`。

### 3. 用微信开发者工具打开项目

- 打开目录：`D:\\miniprogram\\study-english`
- 不要直接打开 `dist`

原因：

- 当前项目不是原生小程序源码，而是 `Taro + React` 源码
- 微信开发者工具实际读取的是 `dist/`
- 根目录的 [project.config.json](/mnt/d/miniprogram/study-english/project.config.json) 已经配置了 `miniprogramRoot: "dist/"`

## 开发流程

1. 在 WSL 中编辑 `/mnt/d/miniprogram/study-english/src`
2. 保持 `npm run dev:weapp` 运行
3. 在微信开发者工具中点击编译或等待自动刷新

## 常用命令

```bash
# 小程序生产构建
npm run build:weapp

# H5 预览构建
npm run build:h5

# H5 监听
npm run dev:h5
```

## 说明

- 当前 UI 主源码在 `src/`
- 小程序产物目录是 `dist/`
- 如果你只改了源码但开发者工具没更新，先确认终端里的 `npm run dev:weapp` 还在运行
