// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Compile this harness and the actual src/icu_shim.c with AddressSanitizer.
#include <assert.h>
#include <stdio.h>
#include <string.h>
void *pivot_icu_open(const char *, int);
void pivot_icu_close(void *);
static void check(int count, int last) {
    char tag[4096] = "en-x-";
    for (int i=0; i<count; i++) {
        if (i) strcat(tag, "-");
        strncat(tag, "aaaaaaaa", i==count-1 ? (size_t)last : 8);
    }
    for (int pivot=0; pivot<2; pivot++) {
        void *collator=pivot_icu_open(tag,pivot);
        assert(collator && "Valid private-use BCP47 tag must remain supported");
        pivot_icu_close(collator);
    }
}
int main(void) {
    // The exact original U_STRING_NOT_TERMINATED_WARNING reproducer first.
    check(17,8);
    for (int count=15; count<=20; count++)
        for (int last=1; last<=8; last++) check(count,last);
    // Also exercise a tag far larger than the old fixed locale buffer.
    check(200,8);
    puts("ICU locale boundary safety: 100 collator lifecycles passed");
}
