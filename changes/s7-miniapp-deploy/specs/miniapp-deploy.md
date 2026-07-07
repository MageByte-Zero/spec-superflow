# S7 · 小程序部署 Spec

## ADDED: 小程序构建与发布 (`miniapp-deploy`)

**ID**: `miniapp-deploy`  
**优先级**: P0  
**状态**: 待开始

### 要求

1. **构建脚本** — `package.json` SHALL 包含 `build:mp-weixin` 脚本，通过 `UNI_PLATFORM=mp-weixin uni build` 编译
2. **环境配置** — 生产环境 SHALL 使用 `.env.production`，`VITE_API_BASE` 指向 `https://jiatingguwen.cn`
3. **AppID** — `manifest.json` SHALL 配置正确的 `mp-weixin.appid`（`wx7b3a39380ae203ef`）
4. **构建产出** — `dist/build/mp-weixin/` SHALL 包含完整可导入微信开发者工具的代码包
5. **服务器域名** — 微信小程序管理后台 SHALL 配置 `jiatingguwen.cn` 到 request 合法域名

### 场景

**Scenario 1: 首次构建**
- WHEN 执行 `npm run build:mp-weixin`
- THEN 产出目录 `dist/build/mp-weixin/` 被创建
- AND 包含 `app.js`、`app.json`、`app.wxss` 等微信小程序必需文件

**Scenario 2: 预览**
- WHEN 在微信开发者工具中导入 `dist/build/mp-weixin/`
- THEN 工具成功解析项目
- AND 首页展示，Tab 各页面正常跳转
- AND API 请求调用 `https://jiatingguwen.cn` 成功

**Scenario 3: API 连通性**
- WHEN 小程序发起 `POST /api/v1/auth/wx-login`
- THEN 请求到达线上后端
- AND 返回正常响应（或合理的 mock 错误）
