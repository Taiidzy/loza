# Loza File Format Specification

## LZEC / LZEA Documentation

------------------------------------------------------------------------

## 1. What is Loza

Loza is a data storage system that allows you to:

-   store files inside container formats
-   encrypt data
-   show thumbnails and metadata without downloading full content
-   stream large media files
-   download only required parts of a file

------------------------------------------------------------------------

## 2. File Formats

### LZEC --- Loza Encrypted Container

Used for a single object such as: - photo - video - audio - document

Examples: - photo.lzec - video.lzec - document.lzec

Features: - metadata support - thumbnail support - preview support -
chunked media streaming - encrypted sections

------------------------------------------------------------------------

### LZEA --- Loza Encrypted Archive

Used for backups and multi-file storage.

Examples: - backup.lzea - photos_backup.lzea - server_backup.lzea

Features: - multiple files and folders - full archive encryption - may
contain both normal files and .lzec containers

------------------------------------------------------------------------

## 3. File Structure

Each file consists of:

\[HEADER\] \[SECTION TABLE\] \[DATA SECTIONS\]

------------------------------------------------------------------------

## 4. Header

The header is the first part of the file.

Example:

Magic = LZEC or LZEA\
Version = 1\
Flags = bitmask\
SectionCount = number of sections

### Magic

Identifies file type: - LZEC - LZEA

### Version

Defines format version for compatibility.

### Flags

Bitmask of enabled features.

Example: - 0x01 encrypted - 0x02 has thumbnail - 0x04 has video

### SectionCount

Number of sections in file.

------------------------------------------------------------------------

## 5. Section Table

Describes file layout.

Each entry contains:

-   ID
-   Type
-   Offset
-   Size
-   Encrypted flag

Example:

ID=1 Metadata\
Offset=4096\
Size=16384\
Encrypted=1

ID=2 Thumbnail\
Offset=20480\
Size=245760\
Encrypted=1

------------------------------------------------------------------------

## 6. Sections

### Metadata

Contains file information such as: - name - resolution - duration -
codec

Example: { "name": "video.mp4", "width": 1920, "height": 1080,
"duration": 3600 }

------------------------------------------------------------------------

### Thumbnail

Small image for quick preview.

Size: 100--200 KB

------------------------------------------------------------------------

### Preview

Medium quality preview for fast viewing.

Size: 1--5 MB

------------------------------------------------------------------------

### Video Index

Describes chunk locations for streaming.

------------------------------------------------------------------------

### Video Chunks

Video split into parts (e.g. 4 MB each) for streaming and fast seeking.

------------------------------------------------------------------------

## 7. Encryption

All sensitive sections can be encrypted using: - AES-256-GCM -
ChaCha20-Poly1305

Encrypted data appears as random bytes without structure.

------------------------------------------------------------------------

## 8. LZEA Archive Structure

Example:

/photos cat.png dog.png /videos movie.mp4 secret.lzec notes.txt

The entire archive is encrypted as a single unit.

------------------------------------------------------------------------

## 9. HTTP Range Support

Allows partial downloads:

Range: bytes=0-50000

Used for: - thumbnails - metadata - video streaming

------------------------------------------------------------------------

## 10. Loading Strategy

Gallery: - header - metadata - thumbnail

Info view: - header - metadata

Video playback: - metadata - video chunks (on demand)

------------------------------------------------------------------------

## 11. Summary

LZEC: - single object container - streaming support - partial download

LZEA: - multi-file archive - full encryption - backup system
