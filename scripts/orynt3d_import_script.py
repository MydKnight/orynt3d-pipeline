import os
import json
import re
import argparse
from collections import defaultdict

# Configuration
BASE_DIR = "\\192.168.254.200\data\3D Files"  # Change to your models directory
OUTPUT_FILE = "orynt3d_import.json"

# Pattern to identify multi-part models and alternatives
# Adjust these patterns based on how your files are named
PART_PATTERN = re.compile(r'(.*?)_part[0-9]+', re.IGNORECASE)
ALTERNATIVE_PATTERN = re.compile(r'(.*?)_variant[0-9]+|_alt[0-9]+', re.IGNORECASE)

def get_model_base_name(filename):
    """Extract base model name from filename, handling parts and alternatives."""
    part_match = PART_PATTERN.match(filename)
    if part_match:
        return part_match.group(1)
    
    alt_match = ALTERNATIVE_PATTERN.match(filename)
    if alt_match:
        return alt_match.group(1)
    
    # Remove file extension
    return os.path.splitext(filename)[0]

def get_metadata_from_path(rel_path):
    """Extract metadata from the file path based on folder structure."""
    path_parts = rel_path.split(os.sep)
    
    if len(path_parts) < 4:
        return None
    
    manufacturer = path_parts[0]
    pack_name = path_parts[1]
    support_status = "supported" if "supported" in path_parts[2].lower() else "unsupported"
    
    # Category might be in different positions depending on folder depth
    category = path_parts[3] if len(path_parts) > 3 else "Unknown"
    
    # Additional subcategories or themes might be present
    subcategories = path_parts[4:] if len(path_parts) > 4 else []
    
    return {
        "manufacturer": manufacturer,
        "pack": pack_name,
        "supportStatus": support_status,
        "category": category,
        "subcategories": subcategories
    }

def preview_configuration(model_groups, level='basic'):
    """
    Preview the import configuration before saving.
    
    Args:
        model_groups: Dictionary of model entries
        level: 'basic', 'detailed', or 'manufacturer'
    """
    total_models = len(model_groups)
    print(f"\n===== CONFIGURATION PREVIEW ({total_models} models) =====\n")
    
    if level == 'basic':
        # Summary by manufacturer and pack
        manufacturer_counts = defaultdict(lambda: defaultdict(int))
        support_status = defaultdict(lambda: defaultdict(int))
        
        for model_key, model_data in model_groups.items():
            manufacturer = model_data["properties"]["source"]
            pack = model_data["properties"]["pack"]
            status = model_data["properties"]["supportStatus"]
            
            manufacturer_counts[manufacturer][pack] += 1
            support_status[manufacturer][status] += 1
        
        print("Models by Manufacturer and Pack:")
        for manufacturer, packs in manufacturer_counts.items():
            print(f"  {manufacturer}:")
            for pack, count in packs.items():
                print(f"    - {pack}: {count} models")
            
            # Support status for this manufacturer
            supported = support_status[manufacturer].get("supported", 0)
            unsupported = support_status[manufacturer].get("unsupported", 0)
            total = supported + unsupported
            supported_pct = (supported / total * 100) if total > 0 else 0
            
            print(f"    Support Status: {supported}/{total} supported ({supported_pct:.1f}%)")
            print()
    
    elif level == 'detailed':
        # Show sample entries for each manufacturer
        manufacturers = set(data["properties"]["source"] for data in model_groups.values())
        
        for manufacturer in manufacturers:
            print(f"\n{manufacturer} - Sample Entries:")
            
            # Get up to 3 sample entries for this manufacturer
            samples = [data for key, data in model_groups.items() 
                      if data["properties"]["source"] == manufacturer][:3]
            
            for i, sample in enumerate(samples):
                print(f"\nSample {i+1}:")
                print(json.dumps(sample, indent=2))
                print("----------")
    
    elif level == 'manufacturer':
        # Detailed view for a specific manufacturer
        manufacturer = input("\nEnter manufacturer name to preview: ")
        
        # Get entries for this manufacturer
        samples = [data for key, data in model_groups.items() 
                  if data["properties"]["source"].lower() == manufacturer.lower()]
        
        if not samples:
            print(f"No entries found for manufacturer: {manufacturer}")
            return
        
        # Get distinct packs
        packs = set(data["properties"]["pack"] for data in samples)
        
        for pack in packs:
            pack_samples = [data for data in samples if data["properties"]["pack"] == pack]
            print(f"\nPack: {pack} ({len(pack_samples)} models)")
            
            # Show a sample entry
            if pack_samples:
                print("\nSample Entry:")
                print(json.dumps(pack_samples[0], indent=2))
            
            # Check for multi-part models
            multi_part = [data for data in pack_samples 
                         if data["properties"].get("hasMultipleParts", False)]
            if multi_part:
                print(f"\n{len(multi_part)} multi-part models in this pack")
                if multi_part:
                    print("\nSample Multi-part Entry:")
                    print(json.dumps(multi_part[0], indent=2))

def main():
    parser = argparse.ArgumentParser(description='Generate Orynt3D import configuration')
    parser.add_argument('--preview', choices=['basic', 'detailed', 'manufacturer'], default='basic',
                        help='Preview level before generating configuration')
    parser.add_argument('--output', default=OUTPUT_FILE,
                        help='Output JSON file path')
    parser.add_argument('--base-dir', default=BASE_DIR,
                        help='Base directory containing models')
    args = parser.parse_args()
    
    base_dir = args.base_dir
    output_file = args.output
    
    print(f"Scanning models in: {base_dir}")
    model_groups = {}
    
    # Walk through directory structure
    for root, dirs, files in os.walk(base_dir):
        for filename in files:
            # Check if it's a 3D model file
            if not filename.lower().endswith(('.stl', '.obj', '.fbx', '.3mf')):
                continue
            
            full_path = os.path.join(root, filename)
            rel_path = os.path.relpath(full_path, base_dir)
            
            # Get metadata from path
            metadata = get_metadata_from_path(rel_path)
            if not metadata:
                print(f"Skipping {rel_path} - unable to extract metadata")
                continue
            
            # Get base model name for grouping parts/alternatives
            base_name = get_model_base_name(filename)
            
            # Create or update model entry
            model_key = f"{metadata['manufacturer']}_{metadata['pack']}_{base_name}"
            
            if model_key not in model_groups:
                # Create new model entry
                model_entry = {
                    "path": full_path.replace("\\", "/"),  # Primary file path
                    "related_files": [],  # For multi-part models
                    "categories": [metadata["category"]] + metadata["subcategories"],
                    "tags": [
                        metadata["manufacturer"].lower().replace(" ", "_"),
                        metadata["pack"].lower().replace(" ", "_"),
                        base_name.lower().replace(" ", "_")
                    ],
                    "properties": {
                        "source": metadata["manufacturer"],
                        "pack": metadata["pack"],
                        "supportStatus": metadata["supportStatus"],
                        "baseModelName": base_name
                    }
                }
                model_groups[model_key] = model_entry
            else:
                # Add as related file to existing entry
                model_groups[model_key]["related_files"].append(full_path.replace("\\", "/"))
    
    # Show preview based on selected level
    preview_configuration(model_groups, level=args.preview)
    
    # Ask user if they want to continue
    while True:
        choice = input("\nGenerate configuration file? (y/n/preview): ").lower()
        
        if choice == 'y':
            break
        elif choice == 'n':
            print("Operation cancelled.")
            return
        elif choice == 'preview':
            preview_level = input("Preview level (basic/detailed/manufacturer): ").lower()
            if preview_level in ['basic', 'detailed', 'manufacturer']:
                preview_configuration(model_groups, level=preview_level)
            else:
                print("Invalid preview level. Using 'basic'.")
                preview_configuration(model_groups, level='basic')
        else:
            print("Invalid choice. Please enter 'y', 'n', or 'preview'.")
    
    # Convert dictionary to list for JSON export
    models_list = []
    for model_key, model_data in model_groups.items():
        # Add related files info to properties if present
        if model_data["related_files"]:
            model_data["properties"]["hasMultipleParts"] = True
            model_data["properties"]["partCount"] = len(model_data["related_files"]) + 1
            model_data["properties"]["related_files"] = model_data["related_files"]
        
        # Remove the working field before adding to final list
        related_files = model_data.pop("related_files")
        models_list.append(model_data)
    
    # Create the final JSON structure
    import_config = {
        "models": models_list
    }
    
    # Write to file
    with open(output_file, "w") as f:
        json.dump(import_config, f, indent=2)
    
    print(f"Created import configuration with {len(models_list)} models.")
    print(f"Configuration saved to {output_file}")

if __name__ == "__main__":
    main()