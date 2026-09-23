"""zhihu_spider.py 纯函数测试，聚焦重构后的 _write_md 和 sanitize_filename。
不测网络/浏览器路径（那些需要真实知乎 API/DrissionPage）。"""

from zhihu_spider import _load_progress, _save_progress, _write_md, sanitize_filename


class TestSanitizeFilename:
    def test_normal_name(self):
        assert sanitize_filename("hello") == "hello"

    def test_special_chars_replaced(self):
        assert sanitize_filename("a/b\\c:d*e?f<g>h|i") == "a、b、c、d、e、f、g、h、i"

    def test_empty_returns_untitled(self):
        assert sanitize_filename("") == "untitled"

    def test_only_spaces_returns_untitled(self):
        assert sanitize_filename("   ") == "untitled"

    def test_strips_whitespace(self):
        assert sanitize_filename("  name  ") == "name"


class TestWriteMd:
    def test_front_matter_format(self, tmp_path):
        filepath = tmp_path / "test.md"
        _write_md(str(filepath), {"title": "T", "author": "A", "voteup": 5}, "正文")
        content = filepath.read_text(encoding="utf-8")
        assert content.startswith("---\n")
        assert "title: T\n" in content
        assert "author: A\n" in content
        assert "voteup: 5\n" in content
        assert "---\n\n" in content
        assert content.endswith("正文")

    def test_front_matter_order_preserved(self, tmp_path):
        filepath = tmp_path / "test.md"
        fm = {"title": "T", "author": "A", "voteup": 5, "url": "http://x", "created": "2024-01-01"}
        _write_md(str(filepath), fm, "body")
        content = filepath.read_text(encoding="utf-8")
        title_pos = content.index("title:")
        author_pos = content.index("author:")
        voteup_pos = content.index("voteup:")
        url_pos = content.index("url:")
        created_pos = content.index("created:")
        assert title_pos < author_pos < voteup_pos < url_pos < created_pos

    def test_empty_body(self, tmp_path):
        filepath = tmp_path / "test.md"
        _write_md(str(filepath), {"title": "T"}, "")
        content = filepath.read_text(encoding="utf-8")
        assert content.endswith("---\n\n")

    def test_chinese_content(self, tmp_path):
        filepath = tmp_path / "test.md"
        _write_md(str(filepath), {"title": "中文标题", "author": "作者"}, "中文正文内容")
        content = filepath.read_text(encoding="utf-8")
        assert "中文标题" in content
        assert "中文正文内容" in content


class TestProgress:
    def test_load_progress_empty_dir(self, tmp_path):
        assert _load_progress(str(tmp_path)) == set()

    def test_save_and_load_progress(self, tmp_path):
        d = str(tmp_path)
        _save_progress(d, {"1", "2", "3"})
        assert _load_progress(d) == {"1", "2", "3"}

    def test_load_progress_corrupt_file(self, tmp_path):
        p = tmp_path / ".progress.json"
        p.write_text("not json", encoding="utf-8")
        assert _load_progress(str(tmp_path)) == set()

    def test_save_progress_overwrites(self, tmp_path):
        d = str(tmp_path)
        _save_progress(d, {"1"})
        _save_progress(d, {"1", "2"})
        assert _load_progress(d) == {"1", "2"}


def test_browser_answer_md_url_points_to_answer(tmp_path):
    """rc3 回归：浏览器兜底回答的 front matter URL 必须定位到回答本身，
    否则 ingest 会把同一问题下多个回答全部归类成 question:<qid> 并互相覆盖。"""
    import zhihu_spider as zs

    data = {"id": "6300000000000000001", "question_id": "123456",
            "question_title": "测试问题", "author": "张三", "voteup": "5",
            "content": "<p>回答正文</p>"}
    fp = zs.save_browser_answer_md(data, str(tmp_path))
    text = open(fp, encoding="utf-8").read()
    assert "/answer/6300000000000000001" in text, text[:200]
    assert "/question/123456/answer/6300000000000000001" in text

    # 无 question_id 时回退 /answer/<aid>
    data2 = {"id": "6300000000000000002", "question_id": "", "content": "<p>x</p>"}
    fp2 = zs.save_browser_answer_md(data2, str(tmp_path))
    text2 = open(fp2, encoding="utf-8").read()
    assert "url: https://www.zhihu.com/answer/6300000000000000002" in text2
