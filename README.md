# settlement-sandbox

三国题材的单机沙盘。设计文档在 vault 的 `game-202610/` 里，本目录只放代码。

## 这个目录的特殊之处

它放在 vault 的 `_reference-repositories/` 下面，而那一行 `.gitignore` 把整个目录排除在笔记仓之外。所以：

- 这里**不是** git 仓库，也不要在这一份里 `git init`。
- 依赖**不在这里装**（`node_modules` 一旦出现在 vault 里，Obsidian 会去索引那几万个文件）。
- 真正跑 git、装依赖、运行程序的是复制出去的那一份，例如 `C:\Coding\settlement-sandbox\`。

## 两处副本怎么用

- **vault 里这一份是工作副本**，AI Assistant 只改这一份。
- **复制出去的那一份**只用来 `npm install`、跑测试、运行程序、做 git 操作。
- 复制方向是单向的：vault → 外部。复制时排除 `node_modules/`、`dist/`、`.git/`（前两个这一份里本来就不该有，最后一个永远不会在这一份里出现）。

## 写代码的约束：可擦除 TypeScript

这里不装 TypeScript 编译器，所以引擎与自检要能被 `node` 直接跑（Node 的类型擦除）。为此：

- 不用 `enum`、`namespace`、构造器参数属性（`constructor(private x: number)`）。
- 类型导入一律写 `import type { ... }`。
- 相对导入带 `.ts` 后缀（`./world.ts`），这是 Node 的 ESM 解析要求。
- `tsconfig.json` 里开着 `erasableSyntaxOnly` 与 `verbatimModuleSyntax`，编译器会替你守住这两条。

## 约定

- 提交信息用英文。
- 新写的代码注释用英文；已经写好的中文注释保持不动。
- README 与设计文档用中文。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/engine/` | 世界状态与规则。不依赖任何包，也不引用外壳 |
| `src/shell/` | Electron + React + Vite 的外壳（下一步再写） |
| `tools/` | 能直接用 `node` 跑的自检 |
| `docs/` | 留在 vault，见上面的说明 |

## 跑起来

在**复制出去的那一份**里（依赖不在这里装）：

```
npm install
npm install -D electron electron-vite vite @vitejs/plugin-react @types/node @types/react @types/react-dom
npm install react react-dom
npm run dev
```

版本号故意不预填：上面那条命令会让 npm 解析出当前的版本再写进 `package.json`，比手写一个可能不存在的号稳。

窗口起来之后：

- 顶部是日期与时间轴：自动走／暂停、速度档（1／2／4／8／16 天每秒）、推进一天、推进一月。
- 中间是据点表：名称、规模、人口、民心、稳定度、金钱、粮草、势力、上级；除上级外都能就地改。
- 下面是日志（最近 14 条）。
- 世界库放在用户主目录下的 `.settlement-sandbox/world.db`，开发与打包同一个位置；环境变量 `SETTLEMENT_SANDBOX_DATA` 可以盖过它。界面上会把实际路径显示出来。

## 命令

```
npm run dev            # 起窗口（开发模式，改代码自动重建）
npm run build          # 构建
npm run typecheck      # tsc -p .
npm run selftest       # 引擎自检
npm run selftest:db    # 存档层自检
npm run probe:sqlite   # 探针：打印本机 node:sqlite 的接口面
```

在 vault 里这一份，只有两个自检能跑（不需要装任何东西）：

```
node tools/selftest.ts
node tools/selftest-db.ts
```
