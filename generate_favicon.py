#!/usr/bin/env python3
"""
Generate a favicon.ico file with a mask emoji
"""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

def create_favicon():
    try:
        # Create a 32x32 image (favicon standard size)
        size = 32
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        
        # Try to use a system font that supports emojis
        font_size = 24
        font = None
        
        # Try Windows Segoe UI Emoji font
        windows_font_paths = [
            "C:/Windows/Fonts/seguiemj.ttf",
            "C:/Windows/Fonts/seguiemj.TTF",
            "seguiemj.ttf"
        ]
        
        for font_path in windows_font_paths:
            try:
                font = ImageFont.truetype(font_path, font_size)
                print(f"Using font: {font_path}")
                break
            except:
                continue
        
        if font is None:
            # Try macOS
            try:
                font = ImageFont.truetype("/System/Library/Fonts/Apple Color Emoji.ttc", font_size)
                print("Using macOS emoji font")
            except:
                # Fallback to default font
                font = ImageFont.load_default()
                print("Using default font (emoji may not render correctly)")
        
        draw = ImageDraw.Draw(img)
        
        # Draw the mask emoji 🎭
        mask_emoji = "🎭"
        
        # Get text bounding box to center it
        try:
            bbox = draw.textbbox((0, 0), mask_emoji, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            
            # Center the emoji
            x = (size - text_width) // 2 - bbox[0]
            y = (size - text_height) // 2 - bbox[1]
            
            draw.text((x, y), mask_emoji, font=font, embedded_color=True)
        except Exception as e:
            print(f"Warning: Could not render emoji text: {e}")
            # Fallback: draw a simple mask shape
            # Draw a simple mask outline
            draw.ellipse([6, 8, 26, 24], outline=(100, 100, 100), width=2)
            draw.ellipse([10, 12, 14, 16], fill=(255, 255, 255))  # Left eye
            draw.ellipse([18, 12, 22, 16], fill=(255, 255, 255))  # Right eye
        
        # Save as ICO with multiple sizes (16x16, 32x32)
        # Create multiple sizes for the ICO file
        sizes = [(16, 16), (32, 32)]
        icons = []
        
        for size_tuple in sizes:
            resized = img.resize(size_tuple, Image.Resampling.LANCZOS)
            icons.append(resized)
        
        # Save to public/assets/favicon.ico
        output_path = os.path.join('public', 'assets', 'favicon.ico')
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        # Save as ICO with all sizes
        icons[0].save(
            output_path,
            format='ICO',
            sizes=[(s.width, s.height) for s in icons]
        )
        
        print(f"✅ Favicon created successfully at {output_path}")
        return True
        
    except Exception as e:
        print(f"❌ Error creating favicon: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = create_favicon()
    sys.exit(0 if success else 1)
