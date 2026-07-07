# S7 · 小程序部署与发布

## 目标
将 `miniapp/`（uni-app Vue3）编译为微信小程序代码，部署到微信小程序生产环境，对接已就绪的线上后端（`https://jiatingguwen.cn`）。

## 范围

### In
- [x] 安装依赖并验证 mp-weixin 构建
- [ ] 配置生产环境 `.env.production`（API 指向 `https://jiatingguwen.cn/api/v1`）
- [ ] manifest.json 补全 `mp-weixin.appid`
- [ ] `package.json` 添加 `build:mp-weixin` / `dev:mp-weixin` 脚本
- [ ] 构建产出 `dist/build/mp-weixin/`
- [ ] 微信开发者工具导入预览
- [ ] 小程序上传审核（手动或 CI）
- [ ] 后端 API 网络策略（如果需要加白名单等）

### Out
- 小程序 UI 改动/新增页面
- P1 业务功能
- SEO / 性能监控

## 前置条件
- 微信小程序 AppID：`wx7b3a39380ae203ef`（已配置）
- 线上后端：`https://jiatingguwen.cn`（已部署）
- 微信小程序服务器域名白名单需配置 `jiatingguwen.cn`
