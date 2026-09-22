import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/descriptor.dart';

/// Form component that dynamically renders form fields for any ClassDescriptor
/// without any hardcoded domain entity screens, adhering to flutter-descriptor-v1 §4 & §14.4.
class DynamicEntityForm extends StatefulWidget {
  final ClassDescriptor classDescriptor;
  final Map<String, dynamic>? initialValues;
  final void Function(Map<String, dynamic> values)? onSave;

  const DynamicEntityForm({
    super.key,
    required this.classDescriptor,
    this.initialValues,
    this.onSave,
  });

  @override
  State<DynamicEntityForm> createState() => _DynamicEntityFormState();
}

class _DynamicEntityFormState extends State<DynamicEntityForm> {
  final _formKey = GlobalKey<FormState>();
  late final Map<String, dynamic> _formData;
  final Map<String, TextEditingController> _controllers = {};

  @override
  void initState() {
    super.initState();
    _formData = Map<String, dynamic>.from(widget.initialValues ?? {});
    for (final attr in widget.classDescriptor.attributes) {
      final initialVal = _formData[attr.name];
      if (attr.uiType == 'checkbox') {
        _formData[attr.name] = (initialVal is bool) ? initialVal : false;
      } else {
        final textVal = initialVal?.toString() ?? '';
        _controllers[attr.name] = TextEditingController(text: textVal);
        _formData[attr.name] = initialVal;
      }
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ...widget.classDescriptor.attributes.map(_buildFieldForAttribute),
          const SizedBox(height: 16),
          ElevatedButton(
            key: Key('btn_save_${widget.classDescriptor.name.toLowerCase()}'),
            onPressed: _submit,
            child: Text('Save ${widget.classDescriptor.name}'),
          ),
        ],
      ),
    );
  }

  Widget _buildFieldForAttribute(AttributeDescriptor attr) {
    final key = Key('field_${attr.name}');
    final labelText = '${attr.name}${attr.required ? ' *' : ''}';
    final helperText = attr.description;

    switch (attr.uiType) {
      case 'checkbox':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4.0),
          child: CheckboxListTile(
            key: key,
            title: Text(labelText),
            subtitle: helperText != null ? Text(helperText) : null,
            value: (_formData[attr.name] as bool?) ?? false,
            onChanged: (val) {
              setState(() {
                _formData[attr.name] = val ?? false;
              });
            },
          ),
        );

      case 'integerField':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: TextFormField(
            key: key,
            controller: _controllers[attr.name],
            decoration: InputDecoration(
              labelText: labelText,
              helperText: helperText,
              border: const OutlineInputBorder(),
            ),
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'^-?\d*'))],
            validator: (value) {
              if (attr.required && (value == null || value.trim().isEmpty)) {
                return 'Field "${attr.name}" is required.';
              }
              if (value != null && value.trim().isNotEmpty) {
                if (int.tryParse(value.trim()) == null) {
                  return 'Field "${attr.name}" must be a valid integer.';
                }
              }
              return null;
            },
            onSaved: (val) {
              _formData[attr.name] = (val != null && val.trim().isNotEmpty)
                  ? int.tryParse(val.trim())
                  : null;
            },
          ),
        );

      case 'decimalField':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: TextFormField(
            key: key,
            controller: _controllers[attr.name],
            decoration: InputDecoration(
              labelText: labelText,
              helperText: helperText,
              border: const OutlineInputBorder(),
            ),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'^-?\d*\.?\d*')),
            ],
            validator: (value) {
              if (attr.required && (value == null || value.trim().isEmpty)) {
                return 'Field "${attr.name}" is required.';
              }
              if (value != null && value.trim().isNotEmpty) {
                if (double.tryParse(value.trim()) == null) {
                  return 'Field "${attr.name}" must be a valid decimal number.';
                }
              }
              return null;
            },
            onSaved: (val) {
              _formData[attr.name] = (val != null && val.trim().isNotEmpty)
                  ? double.tryParse(val.trim())
                  : null;
            },
          ),
        );

      case 'datePicker':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: TextFormField(
            key: key,
            controller: _controllers[attr.name],
            decoration: InputDecoration(
              labelText: labelText,
              helperText: helperText ?? 'Format: YYYY-MM-DD',
              border: const OutlineInputBorder(),
              suffixIcon: const Icon(Icons.calendar_today),
            ),
            keyboardType: TextInputType.datetime,
            validator: (value) {
              if (attr.required && (value == null || value.trim().isEmpty)) {
                return 'Field "${attr.name}" is required.';
              }
              if (value != null && value.trim().isNotEmpty) {
                final dateRegex = RegExp(r'^\d{4}-\d{2}-\d{2}$');
                if (!dateRegex.hasMatch(value.trim())) {
                  return 'Must follow format YYYY-MM-DD.';
                }
              }
              return null;
            },
            onSaved: (val) {
              _formData[attr.name] = val?.trim();
            },
          ),
        );

      case 'dateTimePicker':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: TextFormField(
            key: key,
            controller: _controllers[attr.name],
            decoration: InputDecoration(
              labelText: labelText,
              helperText: helperText ?? 'Format: YYYY-MM-DDTHH:MM',
              border: const OutlineInputBorder(),
              suffixIcon: const Icon(Icons.access_time),
            ),
            keyboardType: TextInputType.datetime,
            validator: (value) {
              if (attr.required && (value == null || value.trim().isEmpty)) {
                return 'Field "${attr.name}" is required.';
              }
              if (value != null && value.trim().isNotEmpty) {
                final dtRegex = RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}');
                if (!dtRegex.hasMatch(value.trim())) {
                  return 'Must follow format YYYY-MM-DDTHH:MM.';
                }
              }
              return null;
            },
            onSaved: (val) {
              _formData[attr.name] = val?.trim();
            },
          ),
        );

      case 'uuidField':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: TextFormField(
            key: key,
            controller: _controllers[attr.name],
            readOnly: true,
            decoration: InputDecoration(
              labelText: '$labelText (auto-generated)',
              helperText: helperText,
              border: const OutlineInputBorder(),
            ),
            onSaved: (val) {
              _formData[attr.name] = val?.trim();
            },
          ),
        );

      case 'textList':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: TextFormField(
            key: key,
            controller: _controllers[attr.name],
            maxLines: 3,
            decoration: InputDecoration(
              labelText: labelText,
              helperText: helperText,
              border: const OutlineInputBorder(),
            ),
            validator: (value) {
              if (attr.required && (value == null || value.trim().isEmpty)) {
                return 'Field "${attr.name}" is required.';
              }
              return null;
            },
            onSaved: (val) {
              _formData[attr.name] = val;
            },
          ),
        );

      case 'textField':
      default:
        // Contract §14.4 fallback: render textField for unknown uiType
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 6.0),
          child: TextFormField(
            key: key,
            controller: _controllers[attr.name],
            decoration: InputDecoration(
              labelText: labelText,
              helperText: helperText,
              border: const OutlineInputBorder(),
            ),
            validator: (value) {
              if (attr.required && (value == null || value.trim().isEmpty)) {
                return 'Field "${attr.name}" is required.';
              }
              return null;
            },
            onSaved: (val) {
              _formData[attr.name] = val;
            },
          ),
        );
    }
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      _formKey.currentState?.save();
      widget.onSave?.call(Map<String, dynamic>.from(_formData));
    }
  }
}
