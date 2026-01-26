import hashlib

class PrivacyGuard:
    def __init__(self):
        self.merchant_map = {}

    def mask_merchant(self, real_name):
        if not real_name:
            return "Unknown_Merchant"
            
        if real_name not in self.merchant_map:
            # Create a short hash ID (first 6 chars of MD5)
            hash_id = hashlib.md5(real_name.encode()).hexdigest()[:6].upper()
            masked_name = f"Merchant_{hash_id}"
            self.merchant_map[real_name] = masked_name
        
        return self.merchant_map[real_name]

    def sanitize_transaction(self, transaction_row):
        date, amount_cents, payee, category = transaction_row
        safe_payee = self.mask_merchant(payee)
        amount_dollars = amount_cents / 100.0
        safe_category = category if category else "Uncategorized"
        
        return f"Date: {date} | Payee: {safe_payee} | Amount: ${amount_dollars:.2f} | Category: {safe_category}"

    def unmask_text(self, text):
        if not text:
            return ""
            
        # Sort by length descending to avoid partial matches if any overlaps occur
        reverse_map = {v: k for k, v in self.merchant_map.items()}
        
        output_text = text
        for masked, real in reverse_map.items():
            if masked in output_text:
                output_text = output_text.replace(masked, real)
                
        return output_text
