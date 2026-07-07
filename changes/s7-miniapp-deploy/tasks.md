# S7 · 小程序部署任务

## 文件结构

```
miniapp/
├── .env.production          ← 新增：生产环境配置
├── package.json             ← 修改：添加 build:mp-weixin 脚本
├── src/manifest.json        ← 修改：mp-weixin.appid
└── dist/build/mp-weixin/    ← 构建产出（gitignore）
```

## 接口/契约

无新增 API。小程序调用已有线上后端（`/api/v1/*`）。

## 任务

### Batch 1: 构建环境准备
- [ ] `package.json` scripts 添加 `"build:mp-weixin": "UNI_PLATFORM=mp-weixin uni build"`
- [ ] 创建 `.env.production`：`VITE_API_BASE=https://jiatingguwen.cn`
- [ ] `manifest.json` 中的 `mp-weixin.appid` 设为 `wx7b3a39380ae203ef`

### Batch 2: 本地构建
- [ ] `cd miniapp && npm ci`
- [ ] `npm run build:mp-weixin`
- [ ] 验证产出目录 `dist/build/mp-weixin/` 包含完整小程序代码包

### Batch 3: 微信端操作（需用户配合）
- [ ] 「微信开发者工具」导入 `dist/build/mp-weixin/`
- [ ] 预览：确认首页、Tab 切换、登录流程正常
- [ ] 「微信小程序管理后台」- 开发 - 开发设置 - 配置 `jiatingguwen.cn` 到 request 合法域名
- [ ] 开发者工具上传代码 → 提交审核

### Batch 4: 联调验证
- [ ] 小程序真机预览：wx-login 接口调通
- [ ] 商品列表展示（`GET /api/v1/products`）
- [ ] 内容知识库展示（`GET /api/v1/contents`）
