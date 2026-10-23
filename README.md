# settlement-sandbox

单机沙盘。设计文档在 `game-202610/` ，进度与下一步见 [ROADMAP.md](ROADMAP.md)。

## 这个目录的特殊之处

它放在 vault 的 `_reference-repositories/` 下面，而 `.gitignore` 把整个目录排除在笔记仓之外。所以：

- 这里**不是** git 仓库，也不要在这里 `git init`。
- 依赖**不在这里装**。这里有一个 `node_modules` junction，指到外部那一份的 `node_modules`（3106 个文件、458.7 MB），所以在 vault 里也能跑 `npm run typecheck` 与自检。
- 那个 junction 是链接。若 vault 的索引变慢，在 Obsidian 设置里把 `node_modules` 加进「已排除的文件」。
- 真正跑 git、装依赖、运行程序的是复制出去的那一份，例如 `C:\Coding\settlement-sandbox\`。

## 两处副本怎么用

- **vault 里这一份是工作副本**，AI Assistant 只改这一份。
- **复制出去的那一份**只用来 `npm install`、跑测试、运行程序、做 git 操作。
- 复制方向基本单向：vault → 外部。一个例外：`package.json` 的依赖段与 `package-lock.json` 是 npm 在外部那一份里写定的，每次装了新依赖就把这两个文件拷回 vault 一次，否则下次复制过去会把那几行依赖抹掉。复制时排除 `node_modules/`、`out/`、`dist/`、`.git/`。
- `node_modules` 是 junction：资源管理器拖拽、`Copy-Item -Recurse`、不带 `/XJ` 的 robocopy 都会跟随链接，把那 458.7 MB 复制一份过去。复制时只选 `src/`、`tools/`、几个配置文件与 `*.md`，别把它框进去。

## 代码约束：可擦除 TypeScript

这里不装 TypeScript 编译器，所以引擎与自检要能被 `node` 直接跑（Node 的类型擦除）。为此：

- 不用 `enum`、`namespace`、构造器参数属性（`constructor(private x: number)`）。
- 类型导入一律写 `import type { ... }`。
- 相对导入带 `.ts` 后缀（`./world.ts`），这是 Node 的 ESM 解析要求。
- `tsconfig.json` 里开着 `erasableSyntaxOnly` 与 `verbatimModuleSyntax`，编译器会替你做到。

## 约定

- 提交信息用英文。
- 新写的代码注释用英文；已经写好的中文注释保持不动。

## 若窗口启动失败

`electron` 的二进制不经过 npm 注册表，由它自己的安装脚本另外下载。依赖装完之后若 `node_modules/electron/dist/electron.exe` 不存在，手动执行一次：

```
node node_modules/electron/install.js
```

它会打印下载进度。再执行 `npm rebuild electron` 不一定有用 —— 这一次它显示成功，但什么都没下。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/engine/` | 世界状态与规则。不依赖任何包，也不引用外壳 |
| `src/main/` | 主进程：开窗口、开世界库、六个 IPC 方法 |
| `src/preload/` | 上下文桥：只往渲染进程递六个方法 |
| `src/renderer/` | React 界面：时间轴、三张表、日志 |
| `src/shared/` | 主进程与渲染进程共用的 IPC 名字与接口 |
| `tools/` | 能直接用 `node` 跑的自检 |

## 跑起来

在**复制出去的那一份**里（依赖不在这里装）：

```
npm install
npm install -D "vite@^7" "@vitejs/plugin-react@^5.2.0" "electron-vite@^5.0.0" electron @types/react @types/react-dom
npm install react react-dom
npm run dev
```

版本必须锁成这样，原因是 npm 会默认装最新的 Vite 8，而 `electron-vite` 的稳定版声明的 peer 只到 Vite 7（支持 Vite 8 的只有 6.0.0-beta.x）。`@vitejs/plugin-react@5.2.0` 同时接受 Vite 7 与 8，所以锁 Vite 7 能凑出一套全是正式版的组合。

窗口起来之后：
- 第一行是日期与时间轴：自动走／暂停、速度档（1／2／4／8／16 天每秒）、推进一天、推进一月、保存、快照，最右端是浅色／深色切换。
- 第二行是视图页签：据点、部队、连接，各带条数。
- 据点表：名称、规模、人口、民心、稳定度、金钱、粮草、势力、上级；除上级外都能就地改。
- 部队表：名称、势力、兵力、训练度、组织度、位置、随身粮草、命令。位置是推导出来的，只读，写成「A 城 → B 城 行军 15%」；命令是一个下拉（无／原地待命／前往某据点），改了就地生效，队列多于一条时下面补一行全文。
- 连接表：两端、距离、地貌；距离与地貌可改。
- 下面是日志（最近 14 条）。
- db 放在用户主目录下的 `.settlement-sandbox/world.db`，开发与打包同一个位置；环境变量 `SETTLEMENT_SANDBOX_DATA` 可以覆盖它。界面上会把实际路径显示出来。参数表与主题都存在这个库的 `meta` 表里。

## 命令

```
npm run dev            # 起窗口（开发模式，改代码自动重建）
npm run build          # 构建
npm run typecheck      # tsc -p .
npm run selftest       # 引擎自检
npm run selftest:db    # 存档层自检
npm run probe:sqlite   # 探针：打印本机 node:sqlite 的接口面
```

在 vault 里这一份靠那个 junction 也能跑全套：

```
npm run typecheck
npm run selftest
npm run selftest:db
```

`npm install`、`npm run dev`、`npm run build` 与所有 git 操作仍然只在外部那一份里做。
