/**
 * Converts a 'like' search pattern (with wildcards `*` and `?`) into a case-insensitive regular expression.
 * All other characters are matched literally, so regex characters like `.`, `(`, `+`, `$` etc. are escaped.
 * Wildcards match any character, including newlines.
 * @param pattern pattern to convert, eg `'Al*'`, `'*.jpg'` or `'file?.txt'`
 */
export function likePatternToRegExp(pattern: string) {
    const source = pattern
        .replace(/[.+^${}()|[\]\\\/-]/g, '\\$&') // escape regex characters (except our wildcards)
        .replace(/\*/g, '[\\s\\S]*')
        .replace(/\?/g, '[\\s\\S]');
    return new RegExp(`^${source}$`, 'i');
}
