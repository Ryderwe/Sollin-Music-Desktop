# Sollin｜一款兼容在线和本地的音乐播放客户端

<p>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square"></a>
  <a href="https://github.com/Ryderwe/Sollin-Music-Desktop/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Ryderwe/Sollin-Music-Desktop?style=flat-square"></a>
  <a href="https://github.com/Ryderwe/Sollin-Music-Desktop/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/Ryderwe/Sollin-Music-Desktop?include_prereleases&style=flat-square"></a>
  <img alt="Electron 28" src="https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white&style=flat-square">
  <img alt="React 18" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=20232A&style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white&style=flat-square">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square">
</p>

中文 | [English](README.en.md)

Sollin 是一个基于 Electron、React、TypeScript、Vite 和 Tailwind CSS 构建的跨平台桌面音乐播放器。它主要面向本地播放和在线播放：本地播放负责本地曲库、歌单、歌词、下载和备份；在线播放依赖用户自行导入的 LX JS 音源脚本。

Sollin 桌面端从 `1.3.1` 版本开始开源。本开源版本不包含私有后端账号、激活、服务端云备份等功能，也不包含私有音源脚本或私有音乐 API。公告可选使用公开 GitHub Issue 评论获取，不依赖私有后端。

## 目录

- [环境要求](#环境要求)
- [配置说明](#配置说明)
- [安装依赖](#安装依赖)
- [本地开发](#本地开发)
- [构建](#构建)
- [桌面端打包](#桌面端打包)
- [GitHub Actions 打包](#github-actions-打包)
- [更新检查](#更新检查)
- [公告配置](#公告配置)
- [音源配置](#音源配置)
- [预览图](#预览图)
- [功能清单](#功能清单)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [原生模块](#原生模块)
- [常见问题](#常见问题)
- [开源注意事项](#开源注意事项)
- [致谢](#致谢)
- [许可证](#许可证)
- [Star 趋势](#star-趋势)

## 环境要求

- 推荐 Node.js 20，Node.js 18 或更新版本通常也可以运行。
- npm 9 或更新版本。
- Git。
- 各系统打包建议在目标系统上执行：
  - Windows 安装包建议在 Windows 上打包。
  - macOS 安装包建议在 macOS 上打包。
  - Linux 安装包建议在 Linux 上打包。

Electron 支持有限的跨平台打包，但涉及原生模块、签名和安装器工具时，在目标系统上打包更可靠。

## 配置说明

复制环境变量示例文件：

```bash
cp .env.example .env.local
```

可用变量：

```env
VITE_APP_VERSION=1.3.1
VITE_DEV_SERVER_PORT=5173
VITE_GITHUB_REPO=Ryderwe/Sollin-Music-Desktop
VITE_GITHUB_ANNOUNCEMENT_REPO=Ryderwe/Sollin-Music-Desktop
VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER=1
VITE_GITHUB_ANNOUNCEMENT_AUTHOR=ryderwe
```

配置项说明：

- `VITE_APP_VERSION`：当前应用版本，设置页和更新检查会读取该值。
- `VITE_DEV_SERVER_PORT`：Vite 开发服务器端口。
- `VITE_GITHUB_REPO`：用于检查更新的 GitHub 仓库，格式为 `owner/repo`。
- `VITE_GITHUB_ANNOUNCEMENT_REPO`：用于读取公告评论的 GitHub 仓库，格式为 `owner/repo`。默认使用 `VITE_GITHUB_REPO`。
- `VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER`：用于读取公告的 Issue 编号。官方默认使用 `1`，显式留空时关闭公告检查。
- `VITE_GITHUB_ANNOUNCEMENT_AUTHOR`：只显示该 GitHub 用户发布的评论，默认 `ryderwe`。

开源版本不需要配置私有服务地址。请不要把 `.env.local`、Token、证书、本机路径或内部接口文档提交到仓库。

## 安装依赖

```bash
npm install
```

用于 CI 或正式发布时，建议使用可复现安装：

```bash
npm ci
```

## 本地开发

只启动 Web 渲染进程：

```bash
npm run dev
```

启动完整 Electron 桌面端：

```bash
npm run electron:dev
```

默认 Vite 开发服务器端口为 `5173`，可通过 `VITE_DEV_SERVER_PORT` 修改。

## 构建

构建渲染进程和 Electron 主进程：

```bash
npm run build
```

只构建渲染进程：

```bash
npm run build:web
```

只编译 Electron 主进程：

```bash
npm run electron:compile
```

预览 Vite 生产构建：

```bash
npm run preview
```

## 桌面端打包

打包产物会输出到 `release/` 目录。

### 当前系统打包

```bash
npm run electron:build
```

### Windows

在 Windows 上运行：

```bash
npm run electron:build:win
```

明确打包 x64：

```bash
npm run electron:build:win:x64
```

配置的输出格式：

- NSIS 安装包：`release/*.exe`
- 便携版可执行文件：`release/*.exe`

### macOS

在 macOS 上运行：

```bash
npm run electron:build:mac
```

Apple Silicon：

```bash
npm run electron:build:mac:arm64
```

Intel：

```bash
npm run electron:build:mac:x64
```

配置的输出格式：

- 磁盘映像：`release/*.dmg`
- ZIP 压缩包：`release/*.zip`

未签名的本地构建可以使用：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run electron:build:mac
```

如果要公开分发 macOS 版本，需要配置 Apple Developer 证书和 electron-builder 公证凭据。

### Linux

在 Linux 上运行：

```bash
npm run electron:build:linux
```

明确打包 x64：

```bash
npm run electron:build:linux:x64
```

配置的输出格式：

- AppImage：`release/*.AppImage`
- Debian 包：`release/*.deb`

如果 Debian 或 Ubuntu 打包环境缺少常用工具，可先安装：

```bash
sudo apt-get update
sudo apt-get install -y libarchive-tools
```

## GitHub Actions 打包

`.github/workflows/package.yml` 会构建 Windows、macOS Intel、macOS Apple Silicon 和 Linux 包。

手动打包：

1. 打开 GitHub Actions。
2. 选择 `Package Desktop Apps`。
3. 点击 `Run workflow`。
4. 在任务完成后下载 artifacts。

通过标签触发发布打包：

```bash
git tag v1.3.1
git push origin v1.3.1
```

推送 `v*` 标签会构建所有配置的平台，并创建 GitHub Release 上传产物。也可以在手动运行 workflow 时通过 `publish_release` 输入项发布 Release。

## 更新检查

开源版本使用 GitHub Releases 检查更新。应用会请求 `VITE_GITHUB_REPO` 指向仓库的 latest release，并根据当前系统优先选择匹配的安装包资产。

发布新版本时建议：

1. 更新 `package.json` 和 `.env.example` 中的版本号。
2. 执行构建和打包。
3. 创建形如 `v1.3.2` 的 Git 标签。
4. 在 GitHub Release 中上传 Windows、macOS 和 Linux 安装包。

## 公告配置

开源版本可以从公开 GitHub Issue 评论读取公告。配置 `VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER` 后，应用启动时会请求该 Issue 的 comments API，只显示 `VITE_GITHUB_ANNOUNCEMENT_AUTHOR` 指定用户发布的最新一条评论。用户关闭后会在本地记录已读；同一条评论更新后会再次提示。

使用方式：

1. 在公开仓库中新建一个固定 Issue，例如标题为 `Announcements`。
2. 只用 `ryderwe` 账号在该 Issue 下发布公告评论。
3. 将该 Issue 编号写入 `.env.local` 的 `VITE_GITHUB_ANNOUNCEMENT_ISSUE_NUMBER`。

该功能只请求 GitHub 公共 API，不需要 Token，也不会接入私有后端。

## 音源配置

在线播放和在线搜索依赖用户自行导入的 LX JS 音源脚本。开源仓库不包含私有、付费或内置音源脚本。

在桌面端应用中，可以进入设置页的音源管理：

- 从 URL 导入 LX JS 音源。
- 导入本地 LX JS 音源文件。
- 切换当前启用音源。
- 按音源启用或关闭更新提醒。
- 查看音源脚本声明的平台、动作和音质能力。

请只使用你有权使用的音源脚本、音乐 API 和内容。

## 预览图

- ![AM 播放界面](images/am播放界面.png)
- ![在线首页](images/在线首页.png)
- ![本地首页](images/本地首页.png)
- ![经典播放界面](images/经典播放界面.png)
- ![设置首页](images/设置首页.png)

## 功能清单

### 播放

- 播放、暂停、上一首、下一首。
- 顺序播放、列表循环、单曲循环和随机播放。
- 音量控制和静音。
- 播放进度条和拖动跳转。
- 系统媒体控制集成。
- 迷你播放器模式。
- Windows 和 macOS 下可配置的关闭行为。
- 系统托盘控制。
- 全局快捷键控制播放、暂停、上一首和下一首。
- 在运行环境支持 `setSinkId` 时选择音频输出设备。

### 在线音乐

- 通过用户导入的 LX JS 音源脚本实现在线搜索和在线播放。
- 多平台在线搜索。
- 聚合搜索。
- 在线歌曲、专辑、歌手、歌单和榜单页面。
- 推荐歌单和歌单广场浏览。
- 支持账号来源时提供每日推荐和私人 FM。
- 在线收藏。
- 导入在线歌单，并支持刷新和可选自动更新。
- 当前来源无法播放时尝试来源回退。
- 音质选择，来源支持时可显示普通、无损、高解析等音质标签。

### 本地音乐

- 扫描本地音乐文件夹。
- 按歌曲、专辑、歌手浏览本地曲库。
- 本地收藏。
- 本地歌单。
- 读取本地文件元数据。
- 编辑本地歌曲标签。
- 支持内嵌歌词、翻译歌词、罗马音歌词和逐词歌词，具体取决于文件元数据。
- 支持同名外置歌词和封面文件回退。
- 可配置本地标签优先级，在内嵌元数据和外置文件之间切换。

### 歌单与曲库

- 创建和删除本地歌单。
- 从歌曲菜单和播放器菜单添加歌曲到歌单。
- 侧边栏歌单拖拽排序。
- 导入在线歌单。
- 将支持的在线专辑或歌单转换为本地歌单。
- 最近播放列表。
- 在线音乐和本地音乐分别收藏。

### 歌词

- 标准歌词展示。
- Apple Music 风格歌词展示。
- TTML 歌词渲染。
- 数据可用时支持逐词歌词。
- 翻译和罗马音展示。
- 歌词页和播放器歌词设置。
- Electron 桌面歌词窗口。
- 桌面歌词锁定与解锁。
- macOS 菜单栏歌词。
- 底部播放栏歌词预览。

### 下载

- 在桌面端下载歌曲。
- 下载任务管理页面。
- 自定义下载目录。
- 自定义文件命名规则。
- 下载后写入元数据。
- 可选导出旁挂 `.lrc` 歌词和封面图片。

### 音效

- 音频可视化。
- 均衡器预设和自定义增益。
- 混响预设。
- 空间音频控制。
- 播放速度控制。
- 播放器背景支持专辑封面、流体和可视化模式。

### 数据、备份与同步

- 本地 JSON 导出和导入。
- 可选择备份项目。
- WebDAV 备份和恢复。
- 类似 lx-music-desktop 行为的局域网数据同步。
- 局域网同步支持主机模式和客户端模式。
- 可同步选定曲库数据、不喜欢规则、下载规则和部分界面设置。
- 数据缓存和音频缓存支持容量限制与清理。

### 界面

- 亮色、暗色和跟随系统主题。
- 响应式 Electron 窗口布局。
- 侧边栏展开和收起。
- 搜索历史。
- 设置页按音源、数据、下载、本地音乐、外观、快捷键、音频和关于等模块组织。

### 开源版已移除的功能

- 私有后端账号登录、注册和会话。
- 激活码和设备绑定。
- 私有后端公告和全局通知。
- 服务端云备份。
- 通过私有服务检查更新。
- 通过私有服务下发配置。

## 技术栈

- Electron 28
- React 18
- TypeScript
- Vite 5
- Tailwind CSS
- Zustand
- React Router
- Radix UI
- Framer Motion
- electron-builder

## 项目结构

```text
.
├── electron/                 Electron 主进程、preload 脚本和桌面端 IPC
├── src/
│   ├── components/           通用 React 组件
│   ├── pages/                路由页面
│   ├── services/             播放、搜索、下载、备份和同步服务
│   ├── stores/               Zustand 状态管理
│   ├── types/                共享 TypeScript 类型
│   ├── utils/                工具函数
│   ├── App.tsx               应用路由和顶层副作用
│   └── main.tsx              渲染进程入口
├── build/                    electron-builder 使用的图标和原生资源
├── public/                   静态资源
├── index.html                主渲染页面 HTML
├── desktop-lyrics.html       桌面歌词窗口 HTML
├── package.json              脚本、依赖和 electron-builder 配置
└── vite.config.ts            Vite 配置
```

## 原生模块

本项目使用 Electron 原生模块能力：

- `node-taglib-sharp` 用于音频标签操作。
- `build/Release/qrc_decode.node` 用作原生歌词解码回退。

仓库中的 `qrc_decode.node` 是平台相关二进制文件。如果要为其他系统或架构打包，并且需要该能力，请构建或提供匹配的原生二进制，并更新 `build/Release` 资源布局。

如果缺少原生歌词解码器，应用会优先尝试 JavaScript 解码，并在可能的情况下自动降级。

## 常见问题

### `npm run electron:dev` 无法连接 Vite

检查开发服务器端口：

```bash
VITE_DEV_SERVER_PORT=5174 npm run electron:dev
```

### macOS 打包后无法打开

未签名的本地构建可能被 Gatekeeper 拦截。内部测试可以在 Finder 中通过右键菜单打开。公开分发时应进行签名和公证。

### Windows 打包失败

关闭正在运行的应用实例，清理 `release/` 目录，然后在干净的终端中重新执行打包命令。某些情况下还需要检查杀毒软件是否锁定了输出文件。

### 在线播放失败

确认已经导入并启用了有效音源脚本，同时确认该音源脚本支持当前平台和所选音质。

### 检查更新失败

确认 `VITE_GITHUB_REPO` 指向公开仓库，且该仓库已经创建至少一个 GitHub Release。

## 开源注意事项

- 不要提交 `.env.local`、Token、私有服务地址、签名证书、本机路径或内部接口文档。
- 本仓库只保留桌面客户端代码，不包含私有服务实现和私有音源脚本。
- 如果密钥、Token 或真实服务地址曾经被提交到其他仓库，即使后来删除，也应该立即轮换。
- 发布前检查 Git 历史、release 产物和 CI 日志，确认没有敏感信息。
- 遵守第三方代码、音源脚本、音乐 API 和内容服务的许可与使用条款。
- 本项目是客户端应用，你需要自行确认配置的来源、API 和内容具备合法使用权限。

## 致谢

Sollin 是独立项目，但它受益于以下开源项目的思路和生态：

- [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop)：桌面音乐播放器行为、本地数据流程、同步概念和 LX 音源脚本生态的重要参考。
- [Apple Music-like Lyrics](https://github.com/amll-dev/applemusic-like-lyrics)：用于实现 Apple Music 风格歌词体验的歌词渲染库。
- Electron、React、Vite、TypeScript、Tailwind CSS 以及更广泛的开源生态。

## 许可证

MIT。详见 [LICENSE](LICENSE)。

## Star History

<a href="https://www.star-history.com/?type=date&repos=Ryderwe%2FSollin-Music-Desktop">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Ryderwe/Sollin-Music-Desktop&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Ryderwe/Sollin-Music-Desktop&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Ryderwe/Sollin-Music-Desktop&type=date&legend=top-left" />
 </picture>
</a>
