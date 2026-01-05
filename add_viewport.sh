#!/bin/bash
# Script to add viewport meta tag to all HTML files in a directory
# Usage: ./add_viewport.sh [directory]
# If no directory is specified, uses current directory

# Set target directory (default to current directory)
TARGET_DIR="${1:-.}"

# Check if directory exists
if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory '$TARGET_DIR' does not exist"
    exit 1
fi

echo "Processing HTML files in: $(cd "$TARGET_DIR" && pwd)"
echo "------------------------------------------------------------"

MODIFIED=0
SKIPPED=0

# Process all .html and .htm files
for file in "$TARGET_DIR"/*.html "$TARGET_DIR"/*.htm; do
    # Skip if no files match the pattern
    [ -e "$file" ] || continue
    
    filename=$(basename "$file")
    
    # Check if viewport meta tag already exists
    if grep -q 'name="viewport"' "$file" || grep -q "name='viewport'" "$file"; then
        echo "⊗ $filename: Already has viewport meta tag"
        ((SKIPPED++))
        continue
    fi
    
    # Check if <head> tag exists
    if ! grep -qi '<head>' "$file"; then
        echo "⊗ $filename: No <head> section found"
        ((SKIPPED++))
        continue
    fi
    
    # Add viewport meta tag after <head> tag (case insensitive)
    # Using sed with backup file for safety
    sed -i.bak '/<[Hh][Ee][Aa][Dd]>/a\
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
' "$file"
    
    # Remove backup file
    rm "${file}.bak"
    
    echo "✓ $filename: Added viewport meta tag"
    ((MODIFIED++))
done

echo "------------------------------------------------------------"
echo "Modified: $MODIFIED file(s)"
echo "Skipped: $SKIPPED file(s)"
