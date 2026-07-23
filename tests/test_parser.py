"""parser.py 纯函数测试，不依赖网络/浏览器。

覆盖 html_to_markdown 各标签分支 + extract_metadata / extract_article_metadata。
批次 3 补 table 测试时会扩展本文件。
"""

from parser import extract_article_metadata, extract_metadata, html_to_markdown


class TestHeadings:
    def test_h1(self):
        assert html_to_markdown("<h1>标题</h1>") == "# 标题"

    def test_h2(self):
        assert html_to_markdown("<h2>子标题</h2>") == "## 子标题"

    def test_h6(self):
        assert html_to_markdown("<h6>深层</h6>") == "###### 深层"

    def test_empty_heading_omitted(self):
        assert html_to_markdown("<h1></h1>") == ""


class TestParagraph:
    def test_simple_p(self):
        assert html_to_markdown("<p>hello</p>") == "hello"

    def test_p_with_link(self):
        result = html_to_markdown('<p>看 <a href="http://x.com">这</a></p>')
        assert "看" in result and "[这](http://x.com)" in result


class TestList:
    def test_ul(self):
        result = html_to_markdown("<ul><li>a</li><li>b</li></ul>")
        assert "- a" in result and "- b" in result

    def test_ol(self):
        result = html_to_markdown("<ol><li>a</li><li>b</li></ol>")
        assert "1. a" in result and "2. b" in result


class TestBlockquote:
    def test_blockquote(self):
        result = html_to_markdown("<blockquote>引用</blockquote>")
        assert "> 引用" in result


class TestCode:
    def test_pre_with_language(self):
        result = html_to_markdown('<pre><code class="language-python">print(1)</code></pre>')
        assert "```python" in result and "print(1)" in result and result.count("```") == 2

    def test_pre_without_language(self):
        result = html_to_markdown("<pre><code>raw</code></pre>")
        assert "```" in result and "raw" in result

    def test_inline_code(self):
        result = html_to_markdown("<p>用 <code>x</code> 变量</p>")
        assert "`x`" in result


class TestLink:
    def test_link_with_text(self):
        result = html_to_markdown('<p><a href="http://x.com">链接</a></p>')
        assert "[链接](http://x.com)" in result

    def test_link_empty_text_falls_back_to_href(self):
        result = html_to_markdown('<p><a href="http://x.com"></a></p>')
        assert "http://x.com" in result
        assert "[]" not in result


class TestImage:
    def test_img_src(self):
        result = html_to_markdown('<p><img src="http://x.com/a.jpg" alt="图"></p>')
        assert "![图](http://x.com/a.jpg)" in result

    def test_img_data_original_fallback(self):
        result = html_to_markdown('<p><img data-original="http://x.com/b.jpg" alt="b"></p>')
        assert "![b](http://x.com/b.jpg)" in result

    def test_img_no_src_omitted(self):
        result = html_to_markdown('<p><img alt="空"></p>')
        assert "![" not in result


class TestStrongEm:
    def test_strong(self):
        result = html_to_markdown("<p><strong>重要</strong></p>")
        assert "**重要**" in result

    def test_em_multi_char(self):
        result = html_to_markdown("<p><em>强调</em></p>")
        assert "*强调*" in result

    def test_em_single_char_keeps_text_without_asterisks(self):
        # 单字符 em 不加 * 格式，但文本必须保留（历史 bug：曾整体丢弃）
        result = html_to_markdown("<p><em>x</em></p>")
        assert "x" in result
        assert "*x*" not in result


class TestHr:
    def test_hr(self):
        result = html_to_markdown("<hr>")
        assert "---" in result


class TestNestedDiv:
    def test_div_wraps_p(self):
        result = html_to_markdown("<div><p>内容</p></div>")
        assert "内容" in result


class TestCleanText:
    def test_collapses_excess_newlines(self):
        result = html_to_markdown("<p>a</p><p>b</p><p>c</p>")
        # 不应出现 3 个以上连续换行
        assert "\n\n\n" not in result

    def test_strips_leading_trailing_newlines(self):
        result = html_to_markdown("<p>hello</p>")
        assert result == "hello"
        assert not result.startswith("\n")
        assert not result.endswith("\n")


class TestExtractMetadata:
    def test_full_answer_metadata(self):
        data = {
            "author": {"name": "张三", "url_token": "zhangsan"},
            "question": {"title": "问题", "id": 123},
            "voteup_count": 42,
            "comment_count": 5,
            "id": 456,
            "created_time": 1700000000,
        }
        meta = extract_metadata(data)
        assert meta["title"] == "问题"
        assert meta["author"] == "张三"
        assert meta["voteup"] == 42
        assert meta["comment_count"] == 5
        assert meta["question_id"] == 123
        assert meta["answer_id"] == 456
        assert meta["url"] == "https://www.zhihu.com/question/123/answer/456"
        assert "zhangsan" in meta["author_url"]

    def test_missing_fields_defaults(self):
        meta = extract_metadata({})
        assert meta["title"] == ""
        assert meta["author"] == ""
        assert meta["voteup"] == 0
        assert meta["created_time"] == 0


class TestExtractArticleMetadata:
    def test_full_article_metadata(self):
        data = {
            "title": "文章标题",
            "author": {"name": "李四", "url_token": "lisi"},
            "voteup_count": 10,
            "comment_count": 2,
            "id": 789,
            "created": 1700000000,
            "image_url": "http://x.com/cover.jpg",
        }
        meta = extract_article_metadata(data)
        assert meta["title"] == "文章标题"
        assert meta["author"] == "李四"
        assert meta["voteup"] == 10
        assert meta["url"] == "https://zhuanlan.zhihu.com/p/789"
        assert meta["image_url"] == "http://x.com/cover.jpg"

    def test_missing_fields_defaults(self):
        meta = extract_article_metadata({})
        assert meta["title"] == ""
        assert meta["author"] == ""
        assert meta["voteup"] == 0


class TestTable:
    def test_table_with_thead(self):
        html = "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>"
        result = html_to_markdown(html)
        assert "| A | B |" in result
        assert "| --- | --- |" in result
        assert "| 1 | 2 |" in result

    def test_table_without_thead(self):
        html = "<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>"
        result = html_to_markdown(html)
        assert "| 1 | 2 |" in result
        assert "| --- | --- |" in result
        assert "| 3 | 4 |" in result

    def test_table_with_link_in_cell(self):
        html = '<table><tr><th>链接</th></tr><tr><td><a href="http://x.com">点这</a></td></tr></table>'
        result = html_to_markdown(html)
        assert "[点这](http://x.com)" in result

    def test_empty_table(self):
        result = html_to_markdown("<table></table>")
        assert result.strip() == ""

    def test_pipe_escaped_in_cell(self):
        html = "<table><tr><td>a|b</td></tr></table>"
        result = html_to_markdown(html)
        assert "a\\|b" in result

    def test_table_inside_div(self):
        html = "<div><table><tr><th>H</th></tr><tr><td>D</td></tr></table></div>"
        result = html_to_markdown(html)
        assert "| H |" in result
        assert "| D |" in result
