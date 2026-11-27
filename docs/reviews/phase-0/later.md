# Phase 0 · later

- Song validator: the "tempo start must be 0 or more" check has no test that isolates it; a non-object entry clears the previous start so a following duplicate is not compared; a tempo may start after the song ends; one test name says "before" but tests "same start".
