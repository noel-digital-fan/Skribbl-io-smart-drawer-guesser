# Skribblio Word Bank
Word Banks for skribbl.io

## Entry
An entry represents a word in the official skribbl word bank. Each entry contains 4 metadata (`word`, `letters`, `lens`, and `difficulty`) that gives information about the word that it represents.

`word` contains the exact word unmodified as a string. It is mostly used for submissions.

`letter` contains all the characters a word contains. It is useful for finding a solution quickly.

`lens` contains an array of numbers. Each number represents the number of character each word has in an entry. (e.g. The entry "Statue of Liberty" has a `lens` as follow: `[6, 2, 7]`).

`difficulty` contains a decimal between 0 and 1 that represents a rough estimate of how difficult a word is to guess (0 is hard and 1 is easy). 

## Sorted Word Banks
Sorted word banks group entries using the order described below:
1. Entries are first grouped together by the number of words they have (e.g. "apple" is considered as 1 word and "jump rope" is considered as 2 words)
2. Then they are sub-grouped by the number of characters they contain (e.g. "apple" contains 5 characters and "jump rope" contains 8 characters)

Example: "jump rope" resides in `wordBank[2][8]` since it contains 2 words and 8 characters.

## Raw Word Banks
Raw word banks do not have any metadata and they simply contain every single possible answer sorted alphabetically. 
