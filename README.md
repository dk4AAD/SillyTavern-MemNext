# SillyTavern-MemNext

An advanced accumulative memory extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern).

## Overview

MemNext replaces standard linear per-message summarization with a three-block accumulative memory architecture:
1. **Long-Term Memory**: Consolidated narrative of past events.
2. **Short-Term Memory**: Detailed rolling window of recent per-message summaries.
3. **Chat History**: Active chat messages beyond the short-term boundary.
