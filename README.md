# ZhihuSpider

知乎内容爬虫，通过知乎 API 爬取问题下的回答、单篇回答或专栏文章，并保存为 Markdown 文件。

## 功能

- 爬取某个问题下的所有（或按点赞/时间排序的）回答
- 爬取单篇回答
- 爬取单篇专栏文章
- **自动 Cookie 捕获**（DrissionPage 控制浏览器登录，自动抓取）
- 支持手动 Cookie（环境变量 / .env / 命令行参数）
- 支持代理
- 自动将 HTML 内容转换为 Markdown 格式
- 保存元数据（标题、作者、点赞数、链接等）

## 安装

```bash
cd D:\Tools\ZhihuSpider
pip install -r requirements.txt
```

## 快速开始

### 第一步：登录并获取 Cookie

```bash
python login.py
```

会自动打开浏览器 → 跳转到知乎登录页 → 扫码/账号登录 → 自动捕获 Cookie 保存到本地。

### 第二步：爬取内容

```bash
# 爬取问题下的回答
python main.py question <问题ID>

# 爬取单篇回答
python main.py answer <回答ID>

# 爬取专栏文章
python main.py article <文章ID>
```

### 示例

```bash
python main.py question 320078376
python main.py question 320078376 --sort voteups      # 按点赞数排序
python main.py question 320078376 --proxy "http://127.0.0.1:7890"
```

## 进阶用法

### Cookie 优先级

1. `--cookie` 命令行参数（最高）
2. `config.json`（由 `login.py` 自动生成）
3. `.env` 文件
4. `ZHIHU_COOKIE` 环境变量

### 手动配置 Cookie

方式一：`.env` 文件
```bash
copy .env.example .env
# 编辑 .env 填入 Cookie
```

方式二：环境变量
```bash
set ZHIHU_COOKIE=你的cookie值
python main.py question 320078376
```

## 注意事项

- 请控制请求频率（默认 3 秒间隔）
- 需要 Cookie 才能正常获取内容
- 仅用于个人学习和研究，请遵守相关法律法规

## 致谢

参考自 [Foxgeek36/ZhihuSpider](https://github.com/Foxgeek36/ZhihuSpider)
