// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#include <unicode/ucol.h>
#include <unicode/uloc.h>
#include <unicode/uversion.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#if U_ICU_VERSION_MAJOR_NUM != 78 || U_ICU_VERSION_MINOR_NUM != 3
#error "pivot-native requires ICU4C 78.3 headers"
#endif
// Intl.Collator's sort usage negotiates only co/kf/kn. Passing the full ICU
// locale would also apply ignored Unicode keys such as ka (punctuation) and ks
// (strength). Keep supported relevant values; unknown values use locale defaults.
static int supported_collation(const char *locale, const char *value, UErrorCode *status) {
    if (!strcmp(value,"search") || !strcmp(value,"standard")) return 0;
    UEnumeration *values = ucol_getKeywordValuesForLocale("collation",locale,0,status);
    if (!values) return 0;
    int supported = 0;
    int32_t length = 0;
    const char *item;
    size_t value_length = strlen(value);
    while ((item = uenum_next(values,&length,status)) != NULL) {
        if (length >= 0 && (size_t)length == value_length && !memcmp(item,value,value_length)) {
            supported = 1; break;
        }
    }
    uenum_close(values);
    return supported;
}
static char *intl_locale(const char *locale, int32_t capacity) {
    char *filtered = malloc((size_t)capacity), *value = malloc((size_t)capacity);
    if (!filtered || !value) { free(filtered); free(value); return NULL; }
    UErrorCode status = U_ZERO_ERROR;
    int32_t length = uloc_getBaseName(locale,filtered,capacity,&status);
    if (U_FAILURE(status) || length < 0 || length >= capacity || filtered[length] != '\0') goto fail;
    const char *keys[] = {"collation","colcasefirst","colnumeric"};
    for (int i=0; i<3; i++) {
        status = U_ZERO_ERROR;
        length = uloc_getKeywordValue(locale,keys[i],value,capacity,&status);
        if (U_FAILURE(status) || length < 0 || length >= capacity || value[length] != '\0') goto fail;
        if (!length) continue;
        int keep = i == 0 ? supported_collation(filtered,value,&status) :
            i == 1 ? (!strcmp(value,"upper") || !strcmp(value,"lower") || !strcmp(value,"no")) :
            (!strcmp(value,"yes") || !strcmp(value,"no"));
        if (U_FAILURE(status)) goto fail;
        if (!keep) continue;
        // Rebuilding a subset of the already expanded ICU keywords cannot
        // exceed the original locale's allocated capacity. This setter also
        // guarantees it never leaves an unterminated partial result.
        length = uloc_setKeywordValue(keys[i],value,filtered,capacity,&status);
        if (U_FAILURE(status) || length < 0 || length >= capacity || filtered[length] != '\0') goto fail;
    }
    free(value);
    return filtered;
fail:
    free(value); free(filtered); return NULL;
}
// Own exactly one collator per returned pointer; callers close it once.
void *pivot_icu_open(const char *tag, int pivot) {
    UVersionInfo version; u_getVersion(version);
    if (version[0] != 78 || version[1] != 3) return NULL;
    UErrorCode status = U_ZERO_ERROR;
    size_t tag_length = strlen(tag);
    if (!tag_length || tag_length > INT32_MAX) return NULL;
    int32_t parsed = 0;
    int32_t needed = uloc_forLanguageTag(tag, NULL, 0, &parsed, &status);
    if ((status != U_BUFFER_OVERFLOW_ERROR && U_FAILURE(status)) ||
        needed < 0 || needed == INT32_MAX || parsed != (int32_t)tag_length) return NULL;
    // ICU reports unterminated full buffers as a *success* warning. Preflight
    // and reserve the terminator, then validate lengths before any C-string use.
    char *locale = malloc((size_t)needed + 1);
    if (!locale) return NULL;
    status = U_ZERO_ERROR;
    int32_t actual = uloc_forLanguageTag(tag, locale, needed + 1, &parsed, &status);
    if (U_FAILURE(status) || actual != needed || parsed != (int32_t)tag_length ||
        locale[actual] != '\0') { free(locale); return NULL; }
    char language[ULOC_LANG_CAPACITY];
    int32_t length = uloc_getLanguage(locale, language, sizeof(language), &status);
    if (U_FAILURE(status) || length <= 0 || length >= (int32_t)sizeof(language)) {
        free(locale); return NULL;
    }
    // ICU silently falls back for unknown languages. Intl.supportedLocalesOf
    // rejects those, so require a collation locale with the requested language.
    int supported = 0;
    for (int32_t i=0; i<ucol_countAvailable(); i++) {
        char available[ULOC_LANG_CAPACITY]; UErrorCode s = U_ZERO_ERROR;
        int32_t length = uloc_getLanguage(ucol_getAvailable(i), available, sizeof(available), &s);
        if (U_SUCCESS(s) && length > 0 && length < (int32_t)sizeof(available) && !strcmp(language, available)) {supported=1; break;}
    }
    if (!supported) { free(locale); return NULL; }
    char *negotiated = intl_locale(locale,needed + 1);
    free(locale);
    if (!negotiated) return NULL;
    UCollator *collator = ucol_open(negotiated, &status);
    free(negotiated);
    if (U_FAILURE(status) || !collator) return NULL;
    ucol_setAttribute(collator, UCOL_NORMALIZATION_MODE, UCOL_ON, &status);
    if (pivot) {
        ucol_setAttribute(collator, UCOL_STRENGTH, UCOL_PRIMARY, &status);
        ucol_setAttribute(collator, UCOL_CASE_LEVEL, UCOL_OFF, &status);
        ucol_setAttribute(collator, UCOL_NUMERIC_COLLATION, UCOL_ON, &status);
    }
    if (U_FAILURE(status)) {ucol_close(collator); return NULL;}
    return collator;
}
void pivot_icu_close(void *collator) { ucol_close((UCollator *)collator); }
int pivot_icu_compare(const void *collator, const char *a, int32_t alen, const char *b, int32_t blen, int32_t *error) {
    UErrorCode status=U_ZERO_ERROR;
    int result=ucol_strcollUTF8((const UCollator *)collator,a,alen,b,blen,&status);
    *error=U_FAILURE(status);
    return result;
}
