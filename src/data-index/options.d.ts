export interface DataIndexOptions {
    /**
     * if strings in the index should be indexed case-sensitive. defaults to `false`
     * @default false
     */
    caseSensitive?: boolean;
    /**
     * locale to use when comparing case insensitive string values. Can be a language code (`"nl"`, `"en"` etc), or LCID (`"en-us"`, `"en-au"` etc).
     * Defaults to English (`"en"`)
     * @default "en"
     */
    textLocale?: string;
    /**
     * To allow multiple languages to be indexed, you can specify the name of the key in the source records that contains the locale.
     * When this key is not present in the data, the specified textLocale will be used as default. Eg with textLocaleKey: 'locale',
     * 1 record might contain `{ text: 'Hello World', locale: 'en' }` (text will be indexed with English locale), and another
     * `{ text: 'Hallo Wereld', locale: 'nl' }` (Dutch locale)
     */
    textLocaleKey?: string;
    /**
     * Other keys' data to include in the index, for faster sorting topN (`.limit.order`) query results
     */
    include?: string[];
}
//# sourceMappingURL=options.d.ts.map