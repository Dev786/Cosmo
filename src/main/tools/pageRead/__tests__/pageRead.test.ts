import { htmlToText, capText, normalizeUrl } from '../index';

describe('htmlToText', () => {
  it('drops script/style/comments and keeps visible text', () => {
    const html = `<html><head><style>.a{color:red}</style><script>evil()</script></head>
      <body><h1>Title</h1><p>Hello <b>world</b>.</p><!-- note --><noscript>x</noscript></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain('Title');
    expect(text).toMatch(/Hello\s+world/);   // inline tags collapse to spaces — fine for LLM input
    expect(text).not.toMatch(/evil|color:red|note/);
  });

  it('decodes common entities and collapses whitespace', () => {
    expect(htmlToText('<p>a &amp; b &lt;c&gt;&nbsp;&#39;d&#39;</p>')).toBe("a & b <c> 'd'");
    expect(htmlToText('<div>one</div>\n\n\n<div>two</div>')).toBe('one\n\ntwo'); // block boundary → paragraph break
  });

  it('inserts line breaks at block boundaries', () => {
    expect(htmlToText('<li>a</li><li>b</li>')).toBe('a\nb');
  });
});

describe('capText', () => {
  it('leaves short text untouched', () => {
    expect(capText('hi', 10)).toBe('hi');
  });
  it('truncates long text with an ellipsis', () => {
    const out = capText('abcdefghij', 5);
    expect(out).toBe('abcde…');
    expect(out.length).toBe(6);
  });
});

describe('normalizeUrl', () => {
  it('adds a scheme when missing', () => {
    expect(normalizeUrl('example.com/x')).toBe('https://example.com/x');
  });
  it('keeps an existing scheme', () => {
    expect(normalizeUrl('http://example.com/')).toBe('http://example.com/');
  });
  it('rejects non-http(s) and junk', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
  });
});
