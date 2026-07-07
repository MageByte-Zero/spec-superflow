# S7 · 小程序部署设计

## 架构

```
miniapp/ (uni-app Vue3)
  │
  ├── npm run build:mp-weixin
  │    └── UNI_PLATFORM=mp-weixin uni build
  │         └── @dcloudio/vite-plugin-uni 编译
  │
  ├── dist/build/mp-weixin/  ← 产出
  │
  ├── 微信开发者工具导入
  │    └── 预览 / 上传
  │
  └── 微信小程序管理后台
       └── 配置 request 合法域名
            └── jiatingguwen.cn
```

## 决策

| 决策 | 选项 | 结论 |
|:---|:---|:---|
| 构建方式 | npm script → CLI | `UNI_PLATFORM=mp-weixin uni build` 是官方方式 |
| AppID 来源 | 已有 `wx7b3a39380ae203ef` | 已在 `project.config.json`；需同步到 `manifest.json` |
| API 环境 | `.env.production` | vite 自动加载，manifest.json 无影响 |
| 上传方式 | 1) CI (miniprogram-ci) 2) 手动 IDE | **手动** — 首次需开发者工具确认；后续可 CI |

## 风险

| 风险 | 影响 | 缓解 |
|:---|:---|:---|
| uni-app 版本兼容 | 构建失败 | 锁定 `@dcloudio/*` 版本，本地验证 |
| API 跨域/白名单 | 请求被拦截 | 微信管理后台提前配置域名白名单 |
| 小程序包超限 | 上传失败 | 控制静态资源，开启分包 |
