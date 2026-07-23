import re

from bs4 import BeautifulSoup


def html_to_markdown(html_content):
    soup = BeautifulSoup(html_content, "html.parser")
    body = soup.body if soup.body else soup
    return _parse_node(body)


def _parse_node(node):
    parts = []
    for child in node.children:
        if isinstance(child, str):
            text = child.strip()
            if text:
                parts.append(text)
            continue
        tag = child.name
        if not tag:
            continue

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            text = child.get_text(strip=True)
            if text:
                parts.append(f"\n{'#' * level} {text}\n")

        elif tag == "p":
            inner = _parse_inline(child).strip()
            if inner:
                parts.append(f"\n{inner}\n")

        elif tag == "br":
            parts.append("\n")

        elif tag in ("ul", "ol"):
            is_ol = tag == "ol"
            for i, li in enumerate(child.find_all("li", recursive=False)):
                prefix = f"{i+1}. " if is_ol else "- "
                inner = _parse_inline(li).strip()
                if inner:
                    parts.append(f"\n{prefix}{inner}")
            parts.append("\n")

        elif tag == "blockquote":
            inner = _parse_node(child).strip()
            if inner:
                indented = "\n".join(f"> {line}" for line in inner.split("\n") if line.strip())
                parts.append(f"\n{indented}\n")

        elif tag in ("pre", "code"):
            code = child.get_text()
            lang = ""
            if tag == "pre":
                cls = child.get("class", [])
                for c in cls:
                    if c.startswith("language-"):
                        lang = c.replace("language-", "")
                        break
                if not lang:
                    inner_code = child.find("code")
                    if inner_code:
                        for c in inner_code.get("class", []):
                            if c.startswith("language-"):
                                lang = c.replace("language-", "")
                                break
                code = child.get_text()
                parts.append(f"\n```{lang}\n{code}\n```\n")
            else:
                parts.append(f"`{code}`")

        elif tag == "hr":
            parts.append("\n---\n")

        elif tag == "table":
            table_md = _parse_table(child)
            if table_md:
                parts.append(f"\n{table_md}\n")
            else:
                parts.append(_parse_node(child))

        elif tag in ("figure", "div", "span", "section", "article"):
            parts.append(_parse_node(child))

        else:
            inner = _parse_inline(child)
            if inner.strip():
                parts.append(inner)

    return _clean_text("".join(parts))


def _parse_table(table_node):
    """将 <table> 转为 Markdown 表格。colspan/rowspan 降级为纯文本。"""
    all_rows = table_node.find_all("tr")
    if not all_rows:
        return ""

    lines = []
    for i, tr in enumerate(all_rows):
        cells = []
        for cell in tr.find_all(["th", "td"], recursive=False):
            text = _parse_inline(cell).strip()
            text = text.replace("\n", " ").replace("|", "\\|")
            cells.append(text)
        if not cells:
            continue
        lines.append("| " + " | ".join(cells) + " |")
        if i == 0:
            lines.append("| " + " | ".join(["---"] * len(cells)) + " |")
    return "\n".join(lines)


def _parse_inline(node):
    parts = []
    for child in node.children:
        if isinstance(child, str):
            text = child
            parts.append(text)
            continue
        tag = child.name
        if not tag:
            continue

        if tag == "a":
            href = child.get("href", "")
            text = child.get_text(strip=True) or href
            if href and text and href != text:
                parts.append(f"[{text}]({href})")
            elif href:
                parts.append(href)
            else:
                parts.append(text)

        elif tag == "img":
            src = child.get("src", "") or child.get("data-original", "") or child.get("data-actualsrc", "")
            alt = child.get("alt", "")
            if src:
                parts.append(f"\n![{alt}]({src})\n")

        elif tag == "strong" or tag == "b":
            text = child.get_text(strip=True)
            if text:
                parts.append(f"**{text}**")

        elif tag == "em" or tag == "i":
            text = child.get_text(strip=True)
            if text:
                if " " in text or len(text) > 1:
                    parts.append(f"*{text}*")
                else:
                    parts.append(text)

        elif tag == "code":
            text = child.get_text()
            parts.append(f"`{text}`")

        elif tag == "br":
            parts.append("\n")

        elif tag in ("span", "u", "s", "del", "mark", "sub", "sup"):
            parts.append(child.get_text())

        elif tag in ("p", "div", "li"):
            inner = _parse_inline(child).strip()
            if inner:
                parts.append(inner)

        else:
            text = child.get_text()
            if text.strip():
                parts.append(text)

    return "".join(parts)


def _clean_text(text):
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" +\n", "\n", text)
    text = re.sub(r"\n +", "\n", text)
    text = re.sub(r"^\n+", "", text)
    text = re.sub(r"\n+$", "", text)
    return text


def extract_metadata(answer_data):
    author = answer_data.get("author", {})
    question = answer_data.get("question", {})
    return {
        "title": question.get("title", ""),
        "author": author.get("name", ""),
        "author_url": f"https://www.zhihu.com/people/{author.get('url_token', '')}",
        "voteup": answer_data.get("voteup_count", 0),
        "comment_count": answer_data.get("comment_count", 0),
        "question_id": question.get("id", ""),
        "answer_id": answer_data.get("id", ""),
        "url": f"https://www.zhihu.com/question/{question.get('id', '')}/answer/{answer_data.get('id', '')}",
        "created_time": answer_data.get("created_time", 0),
    }


def extract_article_metadata(article_data):
    author = article_data.get("author", {})
    return {
        "title": article_data.get("title", ""),
        "author": author.get("name", ""),
        "author_url": f"https://www.zhihu.com/people/{author.get('url_token', '')}",
        "voteup": article_data.get("voteup_count", 0),
        "comment_count": article_data.get("comment_count", 0),
        "article_id": article_data.get("id", ""),
        "url": f"https://zhuanlan.zhihu.com/p/{article_data.get('id', '')}",
        "created_time": article_data.get("created", 0),
        "image_url": article_data.get("image_url", ""),
    }
