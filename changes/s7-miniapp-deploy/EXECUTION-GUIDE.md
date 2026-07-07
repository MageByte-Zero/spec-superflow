# S7 · 微信小程序部署执行指南

## ✅ 已完成（本地）

1. **构建环境就绪**
   - `package.json` 添加 `build:mp-weixin` 脚本
   - `.env.production`：`VITE_API_BASE=https://jiatingguwen.cn`
   - `manifest.json`：`mp-weixin.appid = wx7b3a39380ae203ef`

2. **依赖升级**
   - 升级 `@dcloudio/*` 到 alpha `3.0.0-alpha-5020120260706001`（修复 `isInSSRComponentSetup` 缺失问题）
   - 添加 `@dcloudio/uni-mp-weixin` / `@dcloudio/uni-cli-shared`

3. **构建成功**
   - 产出 `miniapp/dist/build/mp-weixin/` （15M）
   - 包含 `app.js` / `app.json` / `app.wxss` / `project.config.json`
   - `project.config.json` 中 `appid` 已正确写入 `wx7b3a39380ae203ef`

## ⚠️ 需要你手动操作（微信端）

### 步骤 A · 配置服务器域名白名单（必做）

1. 打开 [微信公众平台](https://mp.weixin.qq.com) → 登录
2. 进入「开发」-「开发管理」-「开发设置」-「服务器域名」
3. 在「**request 合法域名**」中添加：
   - `https://jiatingguwen.cn`
4. 「**uploadFile 合法域名**」中（如果后续要上传文件）：
   - `https://jiatingguwen.cn`
5. 「**downloadFile 合法域名**」中：
   - `https://jiatingguwen.cn`
6. 保存。微信审核通常 5–10 分钟生效。

> 💡 若不配置，小程序真机运行时会报 `不在以下 request 合法域名列表中` 错误。

### 步骤 B · 微信开发者工具导入预览

1. 下载安装「[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)」
2. 工具中点击「**导入项目**」
3. 填写：
   - **目录**：`/Users/apple/Desktop/project/若谷心愈/miniapp/dist/build/mp-weixin`
   - **AppID**：`wx7b3a39380ae203ef`（项目配置已自动填入）
   - **项目名称**：`若谷家庭顾问`
4. 点击「**导入**」
5. 预览：
   - 在工具中点击「**编译**」按钮
   - 检查：
     - [ ] 首页正常展示（TabBar 5 个）
     - [ ] 登录页可输入手机号
     - [ ] 评测页跳转
     - [ ] 成长页加载
   - 点击右上角「**预览**」扫码，可在真机预览

### 步骤 C · 上传代码 & 提交审核

1. 工具右上角点击「**上传**」按钮
2. 填写版本号（建议 `0.1.0`）和项目备注
3. 上传成功后会显示版本号
4. 回到 [微信公众平台](https://mp.weixin.qq.com) → 「版本管理」
5. 在「**开发版本**」中找到刚上传的版本，点击「**提交审核**」
6. 等待审核（通常 1–3 小时）

### 步骤 D · 真机/线上联调

审核通过后，「**线上版本**」发布即可。

## 🧪 本地自测清单（建议）

构建已经通过，本地可以做以下自测：

```bash
cd /Users/apple/Desktop/project/若谷心愈/miniapp
node node_modules/@dcloudio/vite-plugin-uni/bin/uni.js build -p mp-weixin
ls dist/build/mp-weixin/app.json    # 应存在
cat dist/build/mp-weixin/project.config.json | grep appid
```

## 📊 后端 API 联调验证

微信小程序里调用以下 API，应该返回成功：

| API | 用途 | 期望 |
|:---|:---|:---|
| `POST /api/v1/auth/wx-login` | 微信登录 | 200 + token |
| `GET /api/v1/contents` | 成长内容列表 | 200 + items |
| `GET /api/v1/products` | 商品列表 | 200 + items |
| `GET /api/v1/fhi/forms` | FHI 评测量表 | 200 + forms |

> ⚠️ **注意**：当前线上后端的 `auth/wx-login` 可能需要真实的微信 code，请确认后端是否已支持 mock。

## 🔧 关键文件路径

| 文件 | 路径 |
|:---|:---|
| 配置文件 | `miniapp/package.json` |
| 环境变量 | `miniapp/.env.production` |
| 清单 | `miniapp/src/manifest.json` |
| 页面注册 | `miniapp/src/pages.json` |
| API 封装 | `miniapp/src/utils/request.ts` |
| 构建产出 | `miniapp/dist/build/mp-weixin/` |